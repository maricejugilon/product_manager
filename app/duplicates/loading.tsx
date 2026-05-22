export default function DuplicateProductsLoading() {
  return (
    <main className="page">
      <div className="page-head">
        <div>
          <h1 className="page-title">Duplicate Products</h1>
          <p className="page-copy">Scanning product names, SKU overlap, images, and listing details.</p>
        </div>
      </div>
      <div className="loading-panel">
        <div>
          <strong>Checking duplicate products</strong>
          <span className="subtle">This can take a moment when scanning all categories.</span>
        </div>
        <div className="pagination-loading-track" aria-hidden>
          <span />
        </div>
      </div>
      <div className="loading-grid">
        <span />
        <span />
        <span />
      </div>
    </main>
  );
}
