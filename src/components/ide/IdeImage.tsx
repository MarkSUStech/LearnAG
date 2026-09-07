/** IDE 图片预览：直接走 /api/raw 流式输出 */
export default function IdeImage({ path }: { path: string }) {
  return (
    <div className="ide-image-view">
      <img src={`/api/raw?path=${encodeURIComponent(path)}`} alt={path} />
      <div className="ide-image-name" title={path}>
        {path.split('/').pop()}
      </div>
    </div>
  )
}
