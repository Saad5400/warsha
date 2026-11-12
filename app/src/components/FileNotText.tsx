import { COPY } from '../copy'
import { formatBytes, imageSourceOf, type FileView } from '../fileView'
import { extOf } from './FileBadge'
import { Button } from './ui/Button'
import { IconDownload } from './ui/Icons'
import { FileIcon } from './ui/LangIcons'

/**
 * The tab's face for a file that is not text (fileView.ts): the picture, when
 * the text really is one, or a calm centred note saying what the file is and
 * that the editor cannot show it — never CodeMirror with an empty line 1.
 */
export function FileNotText({
  path,
  content,
  view,
  onDownload,
}: {
  path: string
  content: string
  view: Exclude<FileView, 'text'>
  onDownload(): void
}) {
  const ext = extOf(path)
  const src = view === 'image' ? imageSourceOf(path, content) : null
  const size = formatBytes(new Blob([content]).size)
  const kind = view === 'image' ? COPY.fileKindImage(ext.toUpperCase()) : COPY.fileKindBinary
  const name = path.slice(path.lastIndexOf('/') + 1)

  return (
    <div className="file-not-text flex min-h-0 flex-1 flex-col items-center justify-center gap-3 overflow-auto bg-surface-1 p-6 text-center" data-view={view}>
      {src ? (
        <>
          <img src={src} alt={name} className="max-h-[70%] max-w-full rounded-sm border border-border-subtle object-contain" />
          <p className="text-meta text-text-3">
            <span dir="auto">{name}</span> · {kind} · <bdi dir="ltr">{size}</bdi>
          </p>
        </>
      ) : (
        <>
          <FileIcon ext={ext} size={48} aria-hidden="true" />
          <p className="text-btn font-semibold text-text-1">{COPY.fileNotShownTitle}</p>
          <p className="text-meta text-text-3">
            <span dir="auto">{name}</span> · {kind} · <bdi dir="ltr">{size}</bdi>
          </p>
          <p className="max-w-[36ch] text-meta leading-normal text-text-2">{COPY.fileNotShownBody}</p>
          <Button variant="ghost" onClick={onDownload} className="gap-2">
            <IconDownload size={16} />
            {COPY.explorerDownload}
          </Button>
        </>
      )}
    </div>
  )
}
