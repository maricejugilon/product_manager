function nameTokens(value: string) {
  return value
    .replace(/flight\s*case/gi, "flight case")
    .toLowerCase()
    .match(/[\p{L}\p{N}]+/gu) ?? [];
}

function isCaseProduct(tokens: Set<string>) {
  return tokens.has("case") || tokens.has("trunk");
}

export function isLikelySiblingProductAccessory(productName: string, accessoryName: string) {
  const productTokens = new Set(nameTokens(productName));
  const accessoryTokens = new Set(nameTokens(accessoryName));

  if (productTokens.size === 0 || accessoryTokens.size === 0) {
    return false;
  }

  const productKey = [...productTokens].join(" ");
  const accessoryKey = [...accessoryTokens].join(" ");

  if (productKey === accessoryKey) {
    return true;
  }

  if (!isCaseProduct(productTokens) || !isCaseProduct(accessoryTokens)) {
    return false;
  }

  const sharedCount = [...productTokens].filter((token) => accessoryTokens.has(token)).length;
  const shorterCoverage = sharedCount / Math.min(productTokens.size, accessoryTokens.size);
  const unionSize = new Set([...productTokens, ...accessoryTokens]).size;
  const similarity = unionSize > 0 ? sharedCount / unionSize : 0;

  return sharedCount >= 4 && shorterCoverage >= 0.75 && similarity >= 0.55;
}
