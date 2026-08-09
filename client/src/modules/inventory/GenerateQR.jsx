/**
 * GenerateQR — select an inventory item, generate a QR code, display + print.
 * Uses the `qrcode` npm package (qrcode.toDataURL).
 */
import { useState, useEffect, useRef } from 'react';
import QRCode from 'qrcode';
import { apiFetch } from '../../shared/utils/api.js';
import styles from './GenerateQR.module.scss';

export default function GenerateQR({ onClose }) {
  const [search,   setSearch]   = useState('');
  const [items,    setItems]    = useState([]);
  const [selected, setSelected] = useState(null);
  const [qrData,   setQrData]   = useState(null);   // { code, item }
  const [qrImage,  setQrImage]  = useState('');     // base64 data URL
  const [loading,  setLoading]  = useState(false);
  const [error,    setError]    = useState('');
  const printRef = useRef(null);

  // ---------------------------------------------------------------------------
  // Search items
  // ---------------------------------------------------------------------------
  useEffect(() => {
    if (search.length < 2) { setItems([]); return; }
    const timer = setTimeout(async () => {
      try {
        const json = await apiFetch(
          `/inventory?search=${encodeURIComponent(search)}&limit=10`
        );
        if (json) setItems(json.data?.items ?? []);
      } catch { /* ignore */ }
    }, 300);
    return () => clearTimeout(timer);
  }, [search]);

  // ---------------------------------------------------------------------------
  // Generate QR from server, then Render with qrcode lib
  // ---------------------------------------------------------------------------
  async function handleGenerate() {
    if (!selected) return;
    setLoading(true);
    setError('');
    setQrData(null);
    setQrImage('');

    try {
      const json = await apiFetch(`/inventory/qr/generate`, {
        method : 'POST',
        headers: { 'Content-Type': 'application/json' },
        body   : JSON.stringify({ itemId: selected.id }),
      });

      setQrData(json.data);

      // Render QR code to base64 PNG using qrcode library
      const dataUrl = await QRCode.toDataURL(json.data.code, {
        width          : 300,
        margin         : 2,
        color          : { dark: '#111827', light: '#ffffff' },
        errorCorrectionLevel: 'M',
      });
      setQrImage(dataUrl);
    } catch (e) {
      setError(e.message);
    } finally {
      setLoading(false);
    }
  }

  // ---------------------------------------------------------------------------
  // Print — uses CSS @media print to show only the print area
  // ---------------------------------------------------------------------------
  function handlePrint() {
    window.print();
  }

  return (
    <div className={styles.overlay} role="dialog" aria-modal="true" aria-label="Generate QR Code">
      <div className={styles.panel}>
        <div className={styles.header}>
          <h3>Generate QR Code</h3>
          <button onClick={onClose} aria-label="Close">✕</button>
        </div>

        <div className={styles.body}>
          {/* Item search */}
          <div className={styles.searchWrap}>
            <label className={styles.fieldLabel} htmlFor="item-search">Search item</label>
            <input
              id="item-search"
              className={styles.searchInput}
              value={search}
              onChange={(e) => { setSearch(e.target.value); setSelected(null); setQrData(null); setQrImage(''); }}
              placeholder="Type item name or SKU…"
              autoComplete="off"
            />
            {items.length > 0 && !selected && (
              <ul className={styles.dropdown} role="listbox">
                {items.map((item) => (
                  <li
                    key={item.id}
                    role="option"
                    aria-selected={selected?.id === item.id}
                    className={styles.dropdownItem}
                    onClick={() => { setSelected(item); setItems([]); setSearch(item.name); }}
                    onKeyDown={(e) => e.key === 'Enter' && setSelected(item)}
                    tabIndex={0}
                  >
                    <span className={styles.itemName}>{item.name}</span>
                    <span className={styles.itemSku}>{item.sku}</span>
                    <span className={styles.itemCat}>{item.category}</span>
                  </li>
                ))}
              </ul>
            )}
          </div>

          {/* Selected item summary */}
          {selected && (
            <div className={styles.selectedCard}>
              <div className={styles.selectedName}>{selected.name}</div>
              <div className={styles.selectedMeta}>
                <span>SKU: {selected.sku}</span>
                <span>{selected.category}</span>
                <span>Stock: {selected.quantity_in_stock} {selected.unit}</span>
              </div>
            </div>
          )}

          <button
            className={styles.generateBtn}
            onClick={handleGenerate}
            disabled={!selected || loading}
          >
            {loading ? 'Generating…' : '🔲 Generate QR Code'}
          </button>

          {error && <div className={styles.error}>{error}</div>}

          {/* QR display */}
          {qrImage && qrData && (
            <div className={styles.qrSection} ref={printRef}>
              {/* Print area — only this is visible when printing */}
              <div className={styles.printArea} id="qr-print-area">
                <div className={styles.printHeader}>
                  {process.env.VITE_HOSPITAL_NAME || 'HMS'} — Inventory
                </div>
                <img
                  src={qrImage}
                  alt={`QR code for ${qrData.item.name}`}
                  className={styles.qrImage}
                />
                <div className={styles.qrItemName}>{qrData.item.name}</div>
                <div className={styles.qrMeta}>
                  <span>SKU: {qrData.item.sku}</span>
                  {qrData.item.location && <span>Location: {qrData.item.location}</span>}
                </div>
                <div className={styles.qrCode}>{qrData.code}</div>
              </div>

              <button className={styles.printBtn} onClick={handlePrint}>
                🖨️ Print QR Label
              </button>
            </div>
          )}
        </div>
      </div>
    </div>
  );
}
