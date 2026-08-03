/**
 * QRScanner — uses @zxing/library for webcam-based QR/barcode decoding.
 *
 * ZXing is loaded from npm (@zxing/library). If you prefer CDN, add to index.html:
 *   <script src="https://unpkg.com/@zxing/library@latest/umd/index.min.js"></script>
 * and replace the import with: const { BrowserMultiFormatReader } = window.ZXing;
 */
import { useState, useEffect, useRef } from 'react';
import { BrowserMultiFormatReader, NotFoundException } from '@zxing/library';
import { apiFetch, API_BASE } from '../../shared/utils/api.js';
import styles from './QRScanner.module.scss';

export default function QRScanner({ onClose }) {
  const [cameras,    setCameras]    = useState([]);
  const [selectedCam, setSelectedCam] = useState('');
  const [scanning,   setScanning]   = useState(false);
  const [result,     setResult]     = useState(null);   // decoded item from API
  const [error,      setError]      = useState('');
  const [lastCode,   setLastCode]   = useState('');

  // Quantity adjustment state
  const [adjustment, setAdjustment] = useState('');
  const [adjReason,  setAdjReason]  = useState('');
  const [adjSaving,  setAdjSaving]  = useState(false);
  const [adjMsg,     setAdjMsg]     = useState('');

  const videoRef  = useRef(null);
  const readerRef = useRef(null);

  // ---------------------------------------------------------------------------
  // Init ZXing reader + enumerate cameras
  // ---------------------------------------------------------------------------
  useEffect(() => {
    const reader = new BrowserMultiFormatReader();
    readerRef.current = reader;

    reader.listVideoInputDevices()
      .then((devices) => {
        setCameras(devices);
        if (devices.length > 0) setSelectedCam(devices[0].deviceId);
      })
      .catch((err) => setError(`Camera access error: ${err.message}`));

    return () => {
      reader.reset();
    };
  }, []);

  // ---------------------------------------------------------------------------
  // Start / stop scanning when selectedCam changes or scanning toggled
  // ---------------------------------------------------------------------------
  useEffect(() => {
    if (!scanning || !selectedCam || !videoRef.current) return;

    const reader = readerRef.current;

    reader.decodeFromVideoDevice(selectedCam, videoRef.current, async (rawResult, err) => {
      if (rawResult) {
        const code = rawResult.getText();
        if (code === lastCode) return; // debounce same code
        setLastCode(code);
        reader.reset();
        setScanning(false);
        await lookupCode(code);
      }
      if (err && !(err instanceof NotFoundException)) {
        // NotFoundException fires every frame when no code found — ignore it
        console.warn('[ZXing]', err.message);
      }
    }).catch((err) => {
      setError(`Scanner error: ${err.message}`);
      setScanning(false);
    });

    return () => {
      reader.reset();
    };
  }, [scanning, selectedCam]); // eslint-disable-line react-hooks/exhaustive-deps

  async function lookupCode(code) {
    setError('');
    setResult(null);
    setAdjMsg('');
    try {
      const json = await apiFetch(`${API_BASE}/inventory/qr/${encodeURIComponent(code)}`);
      setResult(json.data);
    } catch (e) {
      setError(e.message);
    }
  }

  async function handleAdjust(e) {
    e.preventDefault();
    if (!result || !adjustment) return;
    setAdjSaving(true);
    setAdjMsg('');
    try {
      const json = await apiFetch(`${API_BASE}/inventory/${result.id}/adjust`, {
        method : 'PATCH',
        headers: { 'Content-Type': 'application/json' },
        body   : JSON.stringify({ adjustment: parseFloat(adjustment), reason: adjReason }),
      });
      setResult(json.data);
      setAdjMsg(`✅ Updated. New stock: ${json.data.quantity_in_stock} ${json.data.unit}`);
      setAdjustment('');
      setAdjReason('');
    } catch (e) {
      setAdjMsg(`❌ ${e.message}`);
    } finally {
      setAdjSaving(false);
    }
  }

  function handleRescan() {
    setResult(null);
    setError('');
    setLastCode('');
    setAdjMsg('');
    setScanning(true);
  }

  return (
    <div className={styles.overlay} role="dialog" aria-modal="true" aria-label="QR Scanner">
      <div className={styles.panel}>
        <div className={styles.header}>
          <h3>Scan QR / Barcode</h3>
          <button onClick={onClose} aria-label="Close">✕</button>
        </div>

        <div className={styles.body}>
          {/* Camera selector */}
          {cameras.length > 1 && (
            <div className={styles.camSelect}>
              <label htmlFor="cam-select">Camera</label>
              <select
                id="cam-select"
                value={selectedCam}
                onChange={(e) => setSelectedCam(e.target.value)}
              >
                {cameras.map((c) => (
                  <option key={c.deviceId} value={c.deviceId}>{c.label || c.deviceId}</option>
                ))}
              </select>
            </div>
          )}

          {/* Video preview */}
          <div className={styles.videoWrap}>
            <video
              ref={videoRef}
              className={styles.video}
              playsInline
              muted
              aria-label="Camera preview"
            />
            {scanning && (
              <div className={styles.scanOverlay} aria-hidden="true">
                <div className={styles.scanLine} />
                <div className={styles.scanCorners} />
              </div>
            )}
            {!scanning && !result && (
              <div className={styles.videoPlaceholder}>
                <span>📷</span>
                <p>Press "Start Scanning" to activate camera</p>
              </div>
            )}
          </div>

          {/* Controls */}
          {!result && (
            <button
              className={`${styles.scanBtn} ${scanning ? styles.stopBtn : ''}`}
              onClick={() => setScanning((v) => !v)}
              disabled={!selectedCam && cameras.length === 0}
            >
              {scanning ? '⏹ Stop' : '▶ Start Scanning'}
            </button>
          )}

          {error && <div className={styles.error} role="alert">{error}</div>}

          {/* Scan result */}
          {result && (
            <div className={styles.resultCard}>
              <div className={styles.resultHeader}>
                <span className={styles.resultName}>{result.name}</span>
                <span className={`${styles.catBadge} ${styles[result.category?.toLowerCase()]}`}>
                  {result.category}
                </span>
              </div>

              <div className={styles.resultGrid}>
                <div><span>SKU</span><strong>{result.sku}</strong></div>
                <div><span>Stock</span>
                  <strong className={parseFloat(result.quantity_in_stock) <= parseFloat(result.reorder_level) ? styles.lowText : ''}>
                    {result.quantity_in_stock} {result.unit}
                  </strong>
                </div>
                <div><span>Reorder at</span><strong>{result.reorder_level} {result.unit}</strong></div>
                <div><span>Location</span><strong>{result.location ?? '—'}</strong></div>
                {result.expiry_date && (
                  <div><span>Expiry</span><strong>{new Date(result.expiry_date).toLocaleDateString('en-GB')}</strong></div>
                )}
                {result.supplier && (
                  <div><span>Supplier</span><strong>{result.supplier}</strong></div>
                )}
              </div>

              {/* Quantity adjustment */}
              <form className={styles.adjForm} onSubmit={handleAdjust}>
                <h4>Update Quantity</h4>
                <div className={styles.adjRow}>
                  <input
                    type="number"
                    step="0.001"
                    placeholder="e.g. +10 or -5"
                    value={adjustment}
                    onChange={(e) => setAdjustment(e.target.value)}
                    className={styles.adjInput}
                    aria-label="Quantity adjustment"
                  />
                  <input
                    type="text"
                    placeholder="Reason (optional)"
                    value={adjReason}
                    onChange={(e) => setAdjReason(e.target.value)}
                    className={styles.adjInput}
                    aria-label="Reason"
                  />
                  <button
                    type="submit"
                    className={styles.adjBtn}
                    disabled={!adjustment || adjSaving}
                  >
                    {adjSaving ? '…' : 'Apply'}
                  </button>
                </div>
                {adjMsg && <div className={styles.adjMsg}>{adjMsg}</div>}
              </form>

              <button className={styles.rescanBtn} onClick={handleRescan}>
                🔄 Scan another
              </button>
            </div>
          )}
        </div>
      </div>
    </div>
  );
}
