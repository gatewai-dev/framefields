from PIL import Image
im=Image.open('output/probe_code.png').convert('RGB')
print([ (x, im.getpixel((x,540))) for x in (100,500,1000,1500,1850)])
