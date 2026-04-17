import adapter from '@sveltejs/adapter-static';
import { vitePreprocess } from '@sveltejs/vite-plugin-svelte';

/** @type {import('@sveltejs/kit').Config} */
const config = {
	preprocess: vitePreprocess(),
	kit: {
		adapter: adapter({
			pages: 'dist',
			assets: 'dist',
			fallback: 'index.html', // SPA mode — all routes handled client-side
			precompress: true
		}),
		alias: {
			$components: 'src/lib/components',
			$api: 'src/lib/api',
			$stores: 'src/lib/stores',
			$openwrt: 'src/lib/openwrt',
			$utils: 'src/lib/utils'
		}
	}
};

export default config;
