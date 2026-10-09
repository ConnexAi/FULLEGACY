/**
 * Prueba el endpoint real del keep-alive contra un PostgREST simulado.
 *
 * Se intercepta `fetch` (lo que usa supabase-js por dentro, y también el ping
 * al monitor), así que se ejercita el camino completo: el handler → la
 * autorización → supabase-js → HTTP → el upsert → el dead man's switch. Sin
 * tocar la base remota ni ningún monitor de verdad.
 *
 * Lo que importa de verdad acá no es que el camino feliz funcione, sino que
 * los fallos dejen de ser mudos: este endpoint ya se rompió dos veces sin que
 * nadie se enterara (los GRANT en agosto, la pausa del proyecto el 8/10/2026).
 */
const SECRETO = "secreto-de-prueba-largo-y-aleatorio";
const PING = "https://hc-ping.com/identificador-secreto-del-monitor";

process.env.NEXT_PUBLIC_SUPABASE_URL = "https://falso.supabase.co";
process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY = "anon-falsa";
process.env.SUPABASE_SERVICE_ROLE_KEY = "service-falsa";
process.env.CRON_SECRET = SECRETO;
delete process.env.HEALTHCHECK_PING_URL;

const { NextRequest } = await import("next/server");
const { GET } = await import("@/app/api/cron/keep-alive/route");

let fallos = 0;
const ok = (c: boolean, t: string) => {
  if (!c) fallos += 1;
  console.log(`${c ? "  ok  " : "FALLA"} ${t}`);
};
const check = (t: string, real: unknown, esperado: unknown) => {
  const igual = JSON.stringify(real) === JSON.stringify(esperado);
  if (!igual) fallos += 1;
  console.log(
    `${igual ? "  ok  " : "FALLA"} ${t}` +
      (igual
        ? ""
        : `\n        esperado: ${JSON.stringify(esperado)}\n        real:     ${JSON.stringify(real)}`),
  );
};

/* ── PostgREST y monitor simulados ──────────────────────────────────────── */
let fallaLaLectura = false;
let fallaElUpsert = false;
let fallaElPing: "no" | "rechaza" | "500" | "cuelga" = "no";

let lecturas = 0;
let upserts = 0;
let pings = 0;
let ultimoUpsert: Record<string, unknown> | null = null;

/**
 * El último cuerpo que recibió `/latidos`.
 *
 * Se lee a través de una función porque TypeScript, si no, estrecha la
 * variable al `null` del reinicio: no ve que la asigna el `fetch` simulado.
 */
const latido = () => ultimoUpsert;

const reiniciar = () => {
  fallaLaLectura = false;
  fallaElUpsert = false;
  fallaElPing = "no";
  lecturas = 0;
  upserts = 0;
  pings = 0;
  ultimoUpsert = null;
};

const errorPostgrest = (mensaje: string, status: number) =>
  new Response(JSON.stringify({ message: mensaje }), {
    status,
    headers: { "Content-Type": "application/json" },
  });

globalThis.fetch = (async (
  entrada: string | URL | Request,
  init?: RequestInit,
) => {
  const url = String(
    typeof entrada === "object" && "url" in entrada ? entrada.url : entrada,
  );

  if (url.includes("/rest/v1/productos")) {
    lecturas += 1;
    if (fallaLaLectura) return errorPostgrest("permission denied for table productos", 403);
    // `head: true` con `count: exact` lee el conteo del content-range.
    return new Response(null, { status: 200, headers: { "content-range": "*/7" } });
  }

  if (url.includes("/rest/v1/latidos")) {
    upserts += 1;
    // PostgREST acepta el objeto suelto o un array; supabase-js manda lo que
    // se le pasó, así que acá se aceptan las dos formas.
    const cuerpo = JSON.parse(String(init?.body ?? "null"));
    ultimoUpsert = Array.isArray(cuerpo) ? cuerpo[0] : cuerpo;
    if (fallaElUpsert) return errorPostgrest("permission denied for table latidos", 403);
    return new Response(null, { status: 201 });
  }

  if (url === PING) {
    pings += 1;
    if (fallaElPing === "rechaza") throw new TypeError("fetch failed");
    if (fallaElPing === "500") return new Response("nope", { status: 500 });
    if (fallaElPing === "cuelga") {
      // Nunca resuelve por sí misma: la tiene que cortar el
      // AbortSignal.timeout del endpoint.
      return await new Promise<Response>((_, rechazar) => {
        // `AbortSignal.timeout()` usa un temporizador unref'd, que no mantiene
        // vivo el event loop. Sin esta guarda el proceso saldría antes de que
        // el timeout alcance a disparar, y la prueba pasaría sin probar nada.
        const guarda = setTimeout(
          () => rechazar(new Error("el timeout del endpoint nunca cortó el ping")),
          8_000,
        );
        init?.signal?.addEventListener("abort", () => {
          clearTimeout(guarda);
          rechazar(new DOMException("The operation was aborted", "TimeoutError"));
        });
      });
    }
    return new Response("OK", { status: 200 });
  }

  throw new Error("URL inesperada: " + url);
}) as typeof fetch;

/* ── Los logs, que son la mitad del punto de este cambio ────────────────── */
const warnOriginal = console.warn;
let warns: string[] = [];
console.warn = (...partes: unknown[]) => {
  warns.push(partes.map(String).join(" "));
};

const llamar = async (headers: Record<string, string> = {}) => {
  warns = [];
  const respuesta = await GET(
    new NextRequest("https://fullegacy.vercel.app/api/cron/keep-alive", {
      headers,
    }),
  );
  const cuerpo = (await respuesta.json()) as Record<string, unknown>;
  return { status: respuesta.status, cuerpo, warns: warns.join("\n") };
};

const conSecreto = { authorization: `Bearer ${SECRETO}` };

/* ══════════════════════════════════════════════════════════════════════════
   1. Autorización: los dos 401 se distinguen
   ══════════════════════════════════════════════════════════════════════════ */
console.log("── 401 sin header authorization ──");
reiniciar();
{
  const r = await llamar();
  check("responde 401", r.status, 401);
  check("con el cuerpo de siempre", r.cuerpo, { error: "No autorizado" });
  ok(r.warns.includes("no llegó header authorization"), "el log dice que no llegó header");
  ok(r.warns.includes("longitud recibida 0"), "y reporta longitud recibida 0");
  // Lo que estaba roto antes: un 401 no llegaba a Supabase, así que el
  // proyecto se pausaba igual y el log no decía nada.
  check("no se toca Supabase", [lecturas, upserts], [0, 0]);
}

console.log("\n── 401 con header que no coincide ──");
reiniciar();
{
  const otro = "Bearer otro-secreto-cualquiera";
  const r = await llamar({ authorization: otro });
  check("responde 401", r.status, 401);
  ok(
    r.warns.includes("llegó header authorization pero no coincide"),
    "el log distingue este caso del anterior",
  );
  // Las longitudes se calculan, no se escriben a mano: así la prueba no
  // depende de cuánto mida el secreto de prueba.
  ok(
    r.warns.includes(`longitud recibida ${otro.length}`) &&
      r.warns.includes(`esperada ${`Bearer ${SECRETO}`.length}`),
    "compara las longitudes (es el síntoma del salto de línea pegado)",
  );
  ok(!r.warns.includes(SECRETO), "el log NUNCA imprime el secreto");
  ok(!r.warns.includes("otro-secreto-cualquiera"), "ni el header recibido");
  check("tampoco se toca Supabase", [lecturas, upserts], [0, 0]);
}

console.log("\n── El trim: el error que dejó el cron 401 en silencio ──");
reiniciar();
{
  // Exactamente lo que pasa al pegar el valor en el dashboard de Vercel.
  const r = await llamar({ authorization: `Bearer ${SECRETO}\n` });
  check("un salto de línea de más ya NO rompe la autorización", r.status, 200);
}
reiniciar();
{
  process.env.CRON_SECRET = `  ${SECRETO}  `;
  const r = await llamar(conSecreto);
  check("y tampoco si los espacios están del lado de la variable", r.status, 200);
  process.env.CRON_SECRET = SECRETO;
}

/* ══════════════════════════════════════════════════════════════════════════
   2. Camino feliz, con y sin monitor
   ══════════════════════════════════════════════════════════════════════════ */
console.log("\n── Éxito sin HEALTHCHECK_PING_URL ──");
reiniciar();
{
  const r = await llamar(conSecreto);
  check("responde 200", r.status, 200);
  check("ok: true", r.cuerpo.ok, true);
  check("informa el conteo que leyó", r.cuerpo.productos, 7);
  check("una lectura y un latido", [lecturas, upserts], [1, 1]);
  check("sin monitor configurado no se manda ping", pings, 0);
  ok(r.warns === "", "y no hay ningún warn: no configurarlo no es un error");
}

console.log("\n── Éxito con HEALTHCHECK_PING_URL ──");
reiniciar();
process.env.HEALTHCHECK_PING_URL = PING;
{
  const r = await llamar(conSecreto);
  check("responde 200", r.status, 200);
  check("se manda exactamente un ping", pings, 1);
  ok(r.warns === "", "sin warns");
}

/* ══════════════════════════════════════════════════════════════════════════
   3. El upsert deja la fila con la fecha nueva
   ══════════════════════════════════════════════════════════════════════════ */
console.log("\n── El latido que se escribe ──");
reiniciar();
{
  const antes = Date.now();
  const r = await llamar({ ...conSecreto, "user-agent": "vercel-cron/1.0" });
  const despues = Date.now();

  check("la fila es siempre la 1", latido()?.id, 1);
  check("guarda quién lo disparó", latido()?.origen, "vercel-cron/1.0");

  const fecha = Date.parse(String(latido()?.ultimo_latido));
  ok(
    Number.isFinite(fecha) && fecha >= antes && fecha <= despues,
    "ultimo_latido es la fecha de ESTA corrida, no una vieja",
  );
  check(
    "y es la misma que devuelve la respuesta",
    latido()?.ultimo_latido,
    r.cuerpo.ejecutado_en,
  );
}
reiniciar();
{
  await llamar(conSecreto);
  check("sin user-agent el origen queda explícito", latido()?.origen, "desconocido");
}

/* ══════════════════════════════════════════════════════════════════════════
   4. El ping solo se manda si TODO salió bien
   ══════════════════════════════════════════════════════════════════════════ */
console.log("\n── Falla la consulta de lectura ──");
reiniciar();
fallaLaLectura = true;
{
  const r = await llamar(conSecreto);
  check("responde 500", r.status, 500);
  check("ok: false con el motivo", r.cuerpo.ok, false);
  // Si el ping saliera acá, el monitor diría "todo bien" con la base caída:
  // sería peor que no tener monitor.
  check("NO se manda el ping", pings, 0);
  check("y no se escribe ningún latido", upserts, 0);
}

console.log("\n── Falla el upsert del latido ──");
reiniciar();
fallaElUpsert = true;
{
  const r = await llamar(conSecreto);
  check("responde 500", r.status, 500);
  check("se intentó el latido", upserts, 1);
  check("NO se manda el ping", pings, 0);
}

/* ══════════════════════════════════════════════════════════════════════════
   5. El ping es best effort: su fallo no puede romper la respuesta
   ══════════════════════════════════════════════════════════════════════════ */
console.log("\n── El monitor está caído (la red falla) ──");
reiniciar();
fallaElPing = "rechaza";
{
  const r = await llamar(conSecreto);
  check("la respuesta sigue siendo 200 ok", [r.status, r.cuerpo.ok], [200, true]);
  check("el latido sí quedó escrito", upserts, 1);
  ok(r.warns.includes("no se pudo avisar al monitor"), "queda constancia en el log");
  ok(!r.warns.includes(PING), "el log NO incluye la URL (lleva el identificador del monitor)");
  ok(
    r.warns.includes("el keep-alive sí corrió"),
    "y aclara que el keep-alive sí hizo su trabajo",
  );
}

console.log("\n── El monitor responde 500 ──");
reiniciar();
fallaElPing = "500";
{
  const r = await llamar(conSecreto);
  check("la respuesta sigue siendo 200 ok", [r.status, r.cuerpo.ok], [200, true]);
  ok(r.warns.includes("respondió 500"), "se loguea el estado");
  ok(!r.warns.includes(PING), "sin la URL");
}

console.log("\n── El monitor se cuelga (esta sección tarda ~5 s a propósito) ──");
reiniciar();
fallaElPing = "cuelga";
{
  const inicio = Date.now();
  const r = await llamar(conSecreto);
  const tardo = Date.now() - inicio;
  check("la respuesta sigue siendo 200 ok", [r.status, r.cuerpo.ok], [200, true]);
  ok(
    tardo >= 4_000 && tardo < 6_500,
    `el timeout de 5 s la corta (tardó ${tardo} ms, no se queda colgada)`,
  );
  ok(r.warns.includes("no se pudo avisar al monitor"), "y lo loguea");
}

console.warn = warnOriginal;
delete process.env.HEALTHCHECK_PING_URL;

console.log(`\n${fallos === 0 ? "KEEP-ALIVE CORRECTO" : `${fallos} FALLOS`}`);
process.exit(fallos ? 1 : 0);
