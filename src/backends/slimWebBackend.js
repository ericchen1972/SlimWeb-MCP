export const SLIMWEB_BACKEND_METHODS = Object.freeze([
  'listSitesForAdminIdentity',
  'resolveAdminSiteForIdentity',
  'getBasicSettings',
  'updateBasicSettings',
  'listCategories',
  'upsertCategory',
  'deleteCategory',
  'listNavItems',
  'upsertNavItem',
  'deleteNavItem',
  'listProducts',
  'getProduct',
  'prepareProductImageReference',
  'upsertProduct',
  'deleteProduct',
  'inspectProductImport',
  'validateProductImport',
  'commitProductImport',
  'listArticles',
  'checkArticleTitle',
  'getArticleContent',
  'createArticle',
  'updateArticle',
  'deleteArticle'
]);

export function assertSlimWebBackend(backend) {
  for (const method of SLIMWEB_BACKEND_METHODS) {
    if (typeof backend?.[method] !== 'function') {
      throw new TypeError(`SlimWebBackend is missing ${method}().`);
    }
  }

  return backend;
}
