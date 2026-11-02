/**
 * The contract a native build injects as `virtual:moon-native-host` (host.ts loadNativeHost), and the web's no-op default: no shell,
 * so null and the viewer runs on the web host. tsconfig.json maps the virtual id here for the types; the web build never imports it
 * (the branch that does is dropped), and the native shell's build (native/scripts/build.mts) points the id at its own host.
 */
import type { NativeHost } from './host'

export async function createNativeHost(): Promise<NativeHost | null> {
  return null
}
