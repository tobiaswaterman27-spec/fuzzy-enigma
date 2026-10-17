# Joins bodycam front/side/back shots into one sheet: python scripts/sheet.py <dir> <n>
import sys
from PIL import Image
d, n = sys.argv[1], int(sys.argv[2])
for i in range(n):
    ims = [Image.open(f'{d}/body{i}_{j}.png') for j in range(3)]
    out = Image.new('RGB', (sum(im.width for im in ims), ims[0].height))
    x = 0
    for im in ims: out.paste(im, (x, 0)); x += im.width
    out.save(f'{d}/sheet{i}.png')
