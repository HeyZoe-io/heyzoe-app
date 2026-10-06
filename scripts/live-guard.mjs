/** Scripts that write production or send WhatsApp stay dry-run until `--live --slug <business>`. */
export function liveScriptSlug(expectedSlug) {
  const argv = process.argv.slice(2);
  const live = argv.includes("--live");
  const slugFlag = argv.indexOf("--slug");
  const index = slugFlag >= 0 ? slugFlag : argv.indexOf("--business");
  const slug = index >= 0 ? String(argv[index + 1] ?? "").trim().toLowerCase() : "";
  if (!live || !slug) {
    console.log(
      `[dry-run] no writes and no sends. To run for real: --live --slug ${expectedSlug ?? "<business>"}`
    );
    return null;
  }
  if (expectedSlug && slug !== String(expectedSlug).trim().toLowerCase()) {
    console.error(`[dry-run] refusing: --slug ${slug} is not ${expectedSlug}`);
    return null;
  }
  return slug;
}
