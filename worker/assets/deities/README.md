# Approved deity reference portraits

Put one image per deity here, named by its key, and every devotional
scene (all users' profiles) showing that figure is generated to match it (face, complexion,
costume, ornaments). Without one, scenes still get the figure's traditional
iconography in the prompt (`worker/src/engine/lib/iconography.js`).

| Key | Figure | Key | Figure |
| --- | --- | --- | --- |
| `balkrishna` | Bal Krishna (child) | `krishna` | Krishna (adult) |
| `radha` | Radha | `yashoda` | Mother Yashoda |
| `shiva` | Lord Shiva | `parvati` | Goddess Parvati |
| `ganesha` | Lord Ganesha | `kartikeya` | Kartikeya |
| `hanuman` | Lord Hanuman | `ram` | Lord Ram |
| `sita` | Mother Sita | `lakshman` | Lakshman |
| `vishnu` | Lord Vishnu | `lakshmi` | Goddess Lakshmi |
| `durga` | Goddess Durga | `kali` | Goddess Kali |
| `saraswati` | Goddess Saraswati | `shani` | Shani Dev |
| `shailputri` … `siddhidatri` | The nine Navratri forms | | |

How to get them:

1. Copy the approved portraits from the StoryByte app repo's `assets/deities/`
   (made with its **Deity Portraits** workflow), or
2. use your own image you have the rights to. Any size; it's shrunk
   automatically.

They're baked into the worker image, so redeploy the worker after adding one.
