export default function Loading() {
  return (
    <main className="page">
      <div className="loading-shell">
        <div className="loading-panel">
          <div>
            <strong>Loading page</strong>
            <span className="subtle">Fetching the latest WooCommerce data.</span>
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
      </div>
    </main>
  );
}
