import ComponentCatalog from './ComponentCatalog'
export default function Gallery() {
  return <ComponentCatalog gallery disabled={false} onClose={() => { window.location.href = '/' }} onInsert={() => undefined} />
}
