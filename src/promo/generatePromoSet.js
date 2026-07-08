const { fetchPostByUrl, isPromoPost, PROMO_TAG, PROMO_CATEGORY } = require("./wordpress");
const { exportPromoPackage } = require("./exportPromoPackage");

function readArg(name) {
  const args = process.argv.slice(2);
  const prefix = `--${name}=`;
  const inline = args.find((arg) => arg.startsWith(prefix));
  if (inline) return inline.slice(prefix.length);
  const index = args.indexOf(`--${name}`);
  return index >= 0 && !String(args[index + 1] || "").startsWith("--") ? args[index + 1] : undefined;
}

function hasFlag(name) {
  return process.argv.slice(2).includes(`--${name}`);
}

async function main() {
  const url = readArg("url");
  if (!url) {
    console.log(`GPress PROMO generator (preview/export only — не објавува никаде)

Употреба:
  npm run promo:generate -- --url "https://gostivarpress.mk/nekoja-objava/"
  node src/promo/generatePromoSet.js --url "<post-url>" [--force]

PROMO mode се активира само ако објавата има tag "${PROMO_TAG}"
или категорија "Промотивно". Со --force генерира и без тоа (за тест).`);
    process.exitCode = 1;
    return;
  }

  console.log(`[promo] Преземам објава: ${url}`);
  const post = await fetchPostByUrl(url);
  console.log(`[promo] Наслов: ${post.title}`);
  console.log(`[promo] Категории: ${post.categories.join(", ") || "(нема)"}`);
  console.log(`[promo] Тагови: ${post.tags.map((t) => t.slug || t.name).join(", ") || "(нема)"}`);

  const promo = isPromoPost(post);
  console.log(`[promo] Режим: ${promo ? "PROMO" : "NEWS"}`);

  if (!promo && !hasFlag("force")) {
    console.log(`[promo] Објавата нема tag "${PROMO_TAG}" ниту категорија "${PROMO_CATEGORY}" — останува NEWS mode.`);
    console.log(`[promo] За тест-генерирање и покрај тоа, додај --force.`);
    process.exitCode = 1;
    return;
  }

  const result = await exportPromoPackage(post);

  console.log(`\n[promo] Export фолдер: ${result.exportDir}`);
  for (const file of result.written) {
    console.log(`[promo]   + ${file.split(/[\\/]/).pop()}`);
  }

  if (result.sidecarCreated) {
    console.log(`\n[promo] Креиран promo-data.json — дополни адреса/телефон/работно време/профили и пушти ја командата пак за финална верзија.`);
  } else {
    console.log(`\n[promo] Користени податоци од постоечкиот promo-data.json.`);
  }

  if (result.warnings.length) {
    console.log(`\n[promo] Предупредувања:`);
    for (const warning of result.warnings) console.log(`[promo]   ! ${warning}`);
  }

  console.log(`\n[promo] Готово. Ништо не е објавено — фајловите се само export за рачна употреба.`);
}

main().catch((error) => {
  console.error(`[promo:error] ${error.message}`);
  process.exitCode = 1;
});
