/** Returns a log-safe URL containing a public-share or invitation bearer capability. */
export function redactPublicShareCapabilityUrl(rawUrl: string): string {
  return rawUrl
    .replace(/(\/(?:v1\/public-share|share|invite)\/)([^/?#\s]+)/g, '$1:token')
    // OAuth navigation includes the invitation inside an encoded returnTo query value.
    .replace(/(%2finvite%2f)[^&\s#]+/gi, '$1:token');
}
