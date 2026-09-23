import { allExtensions, cruise, format } from 'dependency-cruiser';
import configuration from '../apps/web/backend/dependency-cruiser.config.mjs';

const roots = [
  'apps/web/backend/src',
  'apps/web/frontend/src',
  'packages/sync/src',
  'examples/integrations/src',
];

for (const extension of ['.ts', '.tsx']) {
  if (!allExtensions.some((parser) => parser.extension === extension && parser.available)) {
    throw new Error(`Architecture check requires a parser for ${extension}. Run bun install.`);
  }
}

const { output } = await cruise(roots, {
  ...configuration.options,
  ruleSet: configuration,
  validate: true,
  outputType: 'json',
});
const result = JSON.parse(output);

for (const root of roots) {
  const count = result.modules.filter(
    (module) =>
      module.source.startsWith(`${root}/`) &&
      /\.(?:[cm]?ts|tsx)$/.test(module.source) &&
      module.followable !== false &&
      !module.matchesDoNotFollow &&
      !module.couldNotResolve,
  ).length;
  if (!count) {
    throw new Error(`Architecture check scanned no TypeScript modules in ${root}.`);
  }
  console.log(`${root}: ${count} TypeScript modules`);
}

const report = await format(result, { outputType: 'err-long' });
console.log(report.output);
process.exitCode = report.exitCode;
