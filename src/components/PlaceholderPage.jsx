export default function PlaceholderPage({ title, description }) {
  return (
    <div className="page-placeholder">
      <p className="page-placeholder-eyebrow">Finance Hub</p>
      <h1>{title}</h1>
      <p>{description}</p>
      <span className="page-placeholder-badge">Coming soon</span>
    </div>
  )
}
