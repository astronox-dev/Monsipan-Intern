import adapter from '@sveltejs/adapter-node';
import { vitePreprocess } from '@sveltejs/vite-plugin-svelte';

/** @type {import('@sveltejs/kit').Config} */
const config = {
	preprocess: vitePreprocess(),
	kit: {
		adapter: adapter({ out: 'build', precompress: true }),
		csp: {
			mode: 'auto',
			directives: {
				'default-src': ['self'],
				// zxing-wasm kompiliert WebAssembly für den Kamera-Scanner
				'script-src': ['self', 'wasm-unsafe-eval'],
				'style-src': ['self', 'unsafe-inline'],
				// Kartenkacheln für die Fahrzeuge: basemap.at (amtliche Grundkarte Österreichs)
				'img-src': ['self', 'data:', 'blob:', 'https://mapsneu.wien.gv.at'],
				'font-src': ['self'],
				'connect-src': ['self'],
				'media-src': ['self', 'blob:'],
				'worker-src': ['self', 'blob:'],
				'object-src': ['none'],
				'base-uri': ['self'],
				'form-action': ['self'],
				'frame-ancestors': ['none']
			}
		}
	}
};

export default config;
