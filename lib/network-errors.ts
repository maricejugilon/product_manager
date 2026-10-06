type NetworkErrorKind = "timeout" | "dns" | "connection" | "tls" | "unknown";

function errorDetails(error: unknown) {
  const details: string[] = [];
  let current: unknown = error;

  for (let depth = 0; depth < 5 && current && typeof current === "object"; depth += 1) {
    const value = current as { cause?: unknown; code?: unknown; message?: unknown; name?: unknown };
    details.push(String(value.name ?? ""), String(value.code ?? ""), String(value.message ?? ""));
    current = value.cause;
  }

  return details.join(" ").toLowerCase();
}

export function networkErrorKind(error: unknown): NetworkErrorKind {
  const details = errorDetails(error);

  if (/timeout|timedout|timed out|etimedout|und_err_connect_timeout|aborterror/.test(details)) {
    return "timeout";
  }

  if (/enotfound|eai_again|getaddrinfo|dns/.test(details)) {
    return "dns";
  }

  if (/certificate|self signed|unable_to_verify|cert_|tls|ssl/.test(details)) {
    return "tls";
  }

  if (/econnrefused|econnreset|ehostunreach|enetunreach|eacces|fetch failed|socket/.test(details)) {
    return "connection";
  }

  return "unknown";
}

export function friendlyNetworkError(error: unknown, service: string) {
  const kind = networkErrorKind(error);

  if (kind === "timeout") {
    return new Error(
      `${service} took too long to respond. Please wait a moment, then click Refresh data and try again.`
    );
  }

  if (kind === "dns") {
    return new Error(
      `${service} could not be reached because its address did not resolve. Please check the connection settings and try again.`
    );
  }

  if (kind === "tls") {
    return new Error(
      `A secure connection to ${service} could not be established. Please ask an administrator to check the site's SSL certificate.`
    );
  }

  return new Error(
    `The app could not connect to ${service}. Please confirm it is online, then try again. If this continues, ask an administrator to check the hosting firewall or network access.`
  );
}
