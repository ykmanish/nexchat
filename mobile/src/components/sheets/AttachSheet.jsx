import { Images, Camera, FileText } from 'lucide-react-native';
import { Sheet, SheetRow } from '../Sheet';

/**
 * The attachment picker.
 *
 * A sheet rather than two icons in the composer, matching the web: the three
 * sources read as one decision, and each carries the line that matters —
 * "encrypted before upload" is the thing worth saying at the moment somebody
 * is about to hand over a photo.
 */
export function AttachSheet({ open, onClose, onPickMedia, onPickCamera, onPickDocument }) {
  const run = (fn) => () => {
    onClose();
    // Let the sheet finish dismissing before the system picker takes over, or
    // the two animations fight and the picker opens behind a closing scrim.
    setTimeout(() => fn?.(), 180);
  };

  return (
    <Sheet open={open} onClose={onClose} showHandle>
      <SheetRow
        icon={Images}
        label="Photos & videos"
        description="Encrypted before upload"
        onPress={run(onPickMedia)}
      />
      <SheetRow
        icon={Camera}
        label="Camera"
        description="Take a photo right now"
        onPress={run(onPickCamera)}
      />
      <SheetRow
        icon={FileText}
        label="Document"
        description="Any file up to 50 MB"
        onPress={run(onPickDocument)}
      />
    </Sheet>
  );
}
