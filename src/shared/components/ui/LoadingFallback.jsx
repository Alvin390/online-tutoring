import { motion } from 'framer-motion';

export default function LoadingFallback() {
  return (
    <div className="min-vh-100 d-flex align-items-center justify-content-center">
      <motion.div
        initial={{ opacity: 0, scale: 0.9 }}
        animate={{ opacity: 1, scale: 1 }}
        className="text-center"
      >
        <div className="spinner-border text-primary mb-3" style={{ width: '3rem', height: '3rem' }}>
          <span className="visually-hidden">Loading...</span>
        </div>
        <p className="text-muted">Loading...</p>
      </motion.div>
    </div>
  );
}
