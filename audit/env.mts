// What ran the audit: browser build, renderer, flags. The report header prints these; nothing about them is hard-coded.
export interface BrowserInfo { name: string; version: string; executable: string | null; platform: string; args: string[] }

/** "chromium 141.0.7390.37 (/usr/bin/google-chrome), headless, linux, ANGLE gl-egl". */
export function describeBrowser(b: BrowserInfo): string {
  const angle = b.args.find((a) => a.startsWith('--use-angle='))?.slice('--use-angle='.length)
  return `${b.name} ${b.version}${b.executable ? ` (${b.executable})` : ' (bundled)'}, headless, ${b.platform}${angle ? `, ANGLE ${angle}` : ''}`
}

/** A software rasteriser: its frame times say nothing about a GPU. */
export const isSoftwareRenderer = (renderer: string): boolean => /swiftshader|llvmpipe|softpipe|software|microsoft basic render/i.test(renderer)

/**
 * Chromium flags. Default is the software path (works anywhere, valid for functional checks only); `gpu` selects ANGLE over EGL/GLES,
 * the path that reported the NVIDIA L4 on 2026-10-02. `extra` (env MOON_AUDIT_CHROME_ARGS, space separated) is appended, so a VM that needs
 * other flags (--use-angle=vulkan, --disable-gpu-sandbox) is a setting, not a code change.
 */
export function chromeArgs(o: { platform: string; gpu: boolean; extra: string }): string[] {
  const base = ['--ignore-gpu-blocklist', '--disable-quic']
  const angle = o.gpu ? ['--use-gl=angle', '--use-angle=gl-egl'] : [o.platform === 'darwin' ? '--use-angle=metal' : '--use-angle=swiftshader', ...(o.platform === 'darwin' ? [] : ['--enable-unsafe-swiftshader'])]
  return [...angle, ...base, ...o.extra.split(/\s+/).filter(Boolean)]
}
