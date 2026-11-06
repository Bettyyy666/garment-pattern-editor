// Route an opened or dropped file to the right importer.
import { openImage } from './image-trace.js';
import { loadAnyJSON } from '../spec.js';
import { toast } from '../ui/toast.js';

export function openFile(file) {
  if (!file) return;
  if (/\.json$/i.test(file.name) || file.type === 'application/json') {
    file.text().then((t) => {
      try {
        loadAnyJSON(t, file.name);
      } catch (err) {
        toast('Could not open ' + file.name + ': ' + err.message, true);
      }
    });
    return;
  }
  if (/^image\//.test(file.type) || /\.(png|jpe?g|webp)$/i.test(file.name)) {
    openImage(file);
    return;
  }
  toast('Open a PNG/JPG image or a GarmentCode .json file.', true);
}
