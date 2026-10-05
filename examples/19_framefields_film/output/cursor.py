import sys
from PIL import Image
def ember(p): return p[0]>230 and 70<p[1]<110 and p[2]<60
for f in sys.argv[1:]:
    im=Image.open(f).convert('RGB'); px=im.load(); hits=[]
    for x in range(90,1000):
        run=0
        for y in range(290,900):
            run = run+1 if ember(px[x,y]) else 0
            if run==26: hits.append((x,y-25))
    print(f, hits[:6])
