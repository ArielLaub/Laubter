import { sveltekit } from '@sveltejs/kit/vite';
import tailwindcss from '@tailwindcss/vite';
import { defineConfig } from 'vite';

export default defineConfig({
	plugins: [tailwindcss(), sveltekit()],
	server: {
		proxy: {
			// Proxy /ubus to the actual router during development
			'/ubus': {
				target: 'http://192.168.50.1',
				changeOrigin: true
			}
		}
	}
});
