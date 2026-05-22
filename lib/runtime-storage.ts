import "server-only";

import path from "path";

export function runtimeStorageFile(filename: string) {
  const baseDir =
    process.env.APP_DATA_DIR ||
    (process.env.VERCEL ? path.join("/tmp", "fcw-product-manager") : path.join(process.cwd(), "data"));

  return path.join(baseDir, filename);
}
