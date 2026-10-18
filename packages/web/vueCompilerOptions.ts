/**
 * The Vue template compiler's options (vite.config.ts). No static hoisting: it turns large static templates into HTML
 * strings, and the Content Security Policy (public/_headers) refuses the style attributes in them (the illustrations'
 * `style="fill: var(…)"`). test/csp.test.ts checks it still has that effect.
 */
export const vueCompilerOptions = { hoistStatic: false }
