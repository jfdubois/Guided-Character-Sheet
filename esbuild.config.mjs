import esbuild from 'esbuild';

const isProduction = process.argv[2] === 'production';

const options = {
  entryPoints: ['src/main.ts'],
  bundle: true,
  external: ['obsidian'],
  format: 'cjs',
  target: 'es2021',
  sourcemap: isProduction ? false : 'inline',
  outfile: 'main.js',
};

if (isProduction) {
  await esbuild.build(options);
} else {
  const context = await esbuild.context(options);
  await context.watch();
}
