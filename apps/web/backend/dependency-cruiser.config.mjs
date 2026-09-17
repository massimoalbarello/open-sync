const backend = '^apps/web/backend/src/';
const core = '^packages/sync/src/';

export default {
  forbidden: [
    {
      name: 'integrations-consume-public-contracts',
      severity: 'error',
      from: { path: '^(examples/.*/src/|packages/http-delivery/src/)' },
      to: {
        path: '^(apps/|packages/ui/|packages/sync/src/(db|repositories|services|execution|connector)/|node_modules/@oomol-lab/open-connector/)',
      },
    },
    {
      name: 'only-open-sync-composition-loads-connector',
      severity: 'error',
      from: {
        path: '^(apps/|packages/sync/src/)',
        pathNot: '^packages/sync/src/(open-sync|build)\\.ts$',
      },
      to: { path: 'node_modules/@oomol-lab/open-connector/', dependencyTypesNot: ['type-only'] },
    },
    {
      name: 'host-consumes-open-sync-provider-api',
      severity: 'error',
      from: { path: '^apps/' },
      to: { path: 'node_modules/@oomol-lab/open-connector/' },
    },
    {
      name: 'sync-core-is-headless',
      severity: 'error',
      comment:
        'The core cannot depend on a host, dashboard, authentication library, or connector internals.',
      from: { path: core },
      to: {
        path: '(apps/|^packages/(?!sync/)|node_modules/(react|react-dom|better-auth)/)',
      },
    },
    {
      name: 'sync-models-stay-independent',
      severity: 'error',
      from: { path: `${core}models/` },
      to: { path: `${core}(db|repositories|services|execution|http|connector)/` },
    },
    {
      name: 'sync-services-use-persistence-contracts',
      severity: 'error',
      from: { path: `${core}services/` },
      to: { path: `${core}repositories/`, dependencyTypesNot: ['type-only'] },
    },
    {
      name: 'sync-services-do-not-coordinate-services',
      severity: 'error',
      from: { path: `${core}services/` },
      to: { path: `${core}(services|db|http|connector)/` },
    },
    {
      name: 'sync-persistence-stays-independent',
      severity: 'error',
      from: { path: `${core}(db|repositories)/` },
      to: { path: `${core}(services|execution|http|connector)/` },
    },
    {
      name: 'sync-transport-has-no-database-access',
      severity: 'error',
      from: { path: `${core}(http|connector|execution)/` },
      to: { path: `${core}(db|repositories)/` },
    },

    {
      name: 'resolve-backend-imports',
      severity: 'error',
      comment: 'Fix the internal import so architecture checks can resolve its owner.',
      from: { path: backend },
      to: { path: '^(#backend/|\\.)', couldNotResolve: true },
    },
    {
      name: 'inner-layers-stay-independent',
      severity: 'error',
      comment: 'Models and technical support must not depend on persistence or application layers.',
      from: { path: `${backend}(models|lib)/` },
      to: { path: `${backend}(db|repositories|routes|services)/` },
    },
    {
      name: 'database-stays-independent',
      severity: 'error',
      comment: 'Database infrastructure must not depend on repositories, services, or routes.',
      from: { path: `${backend}db/` },
      to: { path: `${backend}(repositories|routes|services)/` },
    },
    {
      name: 'repositories-receive-infrastructure',
      severity: 'error',
      comment: 'Repositories receive their database and must not depend on services or routes.',
      from: { path: `${backend}repositories/` },
      to: { path: `${backend}(db|routes|services)/` },
    },
    {
      name: 'repository-capabilities-stay-independent',
      severity: 'error',
      comment:
        'Services coordinate repository capabilities. Keep persistence helpers with their owner.',
      from: { path: `${backend}repositories/([^/]+)/` },
      to: {
        path: `${backend}repositories/[^/]+/`,
        pathNot: [`${backend}repositories/$1/`],
      },
    },
    {
      name: 'services-use-repository-contracts',
      severity: 'error',
      comment: 'Import repository contracts with import type; main.ts supplies the implementation.',
      from: { path: `${backend}services/` },
      to: { path: `${backend}repositories/`, dependencyTypesNot: ['type-only'] },
    },
    {
      name: 'services-stay-transport-independent',
      severity: 'error',
      comment: 'Services depend on repository contracts, never database bootstrap or routes.',
      from: { path: `${backend}services/` },
      to: { path: `${backend}(db|routes)/` },
    },
    {
      name: 'service-capabilities-stay-independent',
      severity: 'error',
      comment:
        'Depend on the required repository contracts instead of coordinating another service.',
      from: { path: `${backend}services/([^/]+)/` },
      to: { path: `${backend}services/`, pathNot: `${backend}services/$1/` },
    },
    {
      name: 'controllers-use-services',
      severity: 'error',
      comment:
        'Controllers and the application factory receive services, never persistence modules.',
      from: { path: `${backend}(routes/|app\\.ts$)` },
      to: { path: `${backend}(db|repositories)/` },
    },
    {
      name: 'route-schemas-stay-independent',
      severity: 'error',
      comment: 'Route schemas describe transport contracts without depending on services.',
      from: { path: `${backend}routes/.*/model\\.ts$` },
      to: { path: `${backend}services/` },
    },
    {
      name: 'public-app-type-comes-from-app',
      severity: 'error',
      comment: 'Derive the public application type from app.ts, not implementation layers.',
      from: { path: `${backend}types\\.ts$` },
      to: { path: `${backend}(db|repositories|routes|services)/` },
    },
    {
      name: 'main-owns-production-infrastructure',
      severity: 'error',
      comment: 'Only main.ts selects production configuration and creates infrastructure clients.',
      from: { path: backend, pathNot: `${backend}main\\.ts$` },
      to: { path: `${backend}(db/client|lib/env|lib/storage/client)\\.ts$` },
    },
  ],
  options: {
    doNotFollow: { path: 'node_modules' },
    tsPreCompilationDeps: true,
    enhancedResolveOptions: {
      conditionNames: ['import', 'node', 'default'],
      exportsFields: ['exports'],
    },
  },
};
