from PIL import Image, ImageDraw, ImageFont
import numpy as np, subprocess, wave, math
from pathlib import Path
P=Path(__file__).parent
W,H=1920,1080
navy='#0c1d30'; gold='#d6b651'; red='#a82232'; green='#12624a'
logo=Image.open(P/'logo.jpeg').convert('RGB')
def ease(x): return 1-(1-max(0,min(1,x)))**3
def font(n): return ImageFont.truetype('C:/Windows/Fonts/bahnschrift.ttf',n)
def frame(t):
 im=Image.new('RGB',(W,H),navy); d=ImageDraw.Draw(im)
 def txt(x,y,s,n=36,c='white'): d.text((x,y),s,font=font(n),fill=c)
 def box(b,c,r=24): d.rounded_rectangle(b,radius=r,fill=c)
 def mark(x,y,size):
  a=logo.resize((size,size),Image.Resampling.LANCZOS); im.paste(a,(int(x),int(y)))
 # Geometric brand field
 d.ellipse((1370,-480,2370,520),fill=green)
 d.ellipse((-450,800,450,1700),outline=gold,width=3)
 txt(100,65,'SAQR',32); txt(1580,72,'DIGITAL GUARDIAN',20,gold)
 if t<7.5:
  txt(160,160,'One click.' if t<1.5 else 'Real consequences.' if t<3 else 'See the deception.',78)
  # Browser entrance and gentle forward movement
  off=int(50*(1-ease(t/.55)))
  x,y=160,300+off
  box((x,y,1760,y+650),'#f3f5f7',30)
  box((x,y,1760,y+72),'#dce2e8',30)
  d.rectangle((x,y+38,1760,y+72),fill='#dce2e8')
  for j,c in enumerate(['#c86a6a','#d6b651','#63a58e']): d.ellipse((190+j*26,y+27,202+j*26,y+39),fill=c)
  box((390,y+15,1490,y+57),'#ffffff',12)
  txt(420,y+23,'parcel-confirm.example / delivery',23,navy)
  if t<3:
   txt(225,y+115,'PARCEL / EXPRESS',25,green)
   txt(225,y+165,'Delivery update',53,navy)
   for j in range(3): box((225,y+265+j*70,650-j*45,y+284+j*70),'#dfe5e8',8)
   cy=y+135+int(45*(1-ease(t/.65)))
   box((790,cy,1660,cy+410),'white')
   txt(845,cy+45,'Your delivery is on hold.',43,navy)
   txt(845,cy+123,'Confirm your address and pay AED 4.99.',29,'#576473')
   box((845,cy+220,1598,cy+305),gold if t>=1.75 else green,16)
   txt(1115,cy+240,'Continue',33,navy if t>=1.75 else 'white')
   txt(845,cy+340,'Delivery reference  /  PX-2048',23,'#78838d')
   u=ease((t-1.15)/.6); cx=int(1700-430*u); yy=int(910-260*u)
   d.polygon([(cx,yy),(cx+8,yy+53),(cx+23,yy+37),(cx+44,yy+36)],fill=navy,outline='white',width=3)
   if 1.75<t<2.1:
    r=int(15+100*(t-1.75)); d.ellipse((cx-r,yy-r,cx+r,yy+r),outline=gold,width=3)
   if t>2.2:
    box((790,cy+220,1660,cy+410),'#fff1c9',15)
    txt(845,cy+242,'Payment confirmation',33,navy)
    txt(845,cy+310,'Amount due                         AED 4.99',30,navy)
  else:
   d.rectangle((160,y+72,1760,y+620),fill=red)
   box((160,y+570,1760,y+650),red,30)
   a=ease((t-3)/.2); yy=y+105+int(8*(1-a)); shift=int(170*ease((t-5.5)/.4))
   mark(225,yy,100)
   txt(355,yy+25,'SAQR PROTECTION',26,'#ffcdcb')
   txt(225,yy+145,'This site may be fraudulent',60)
   txt(225,yy+232,'parcel-confirm.example',32,'#ffd6cd')
   txt(225,yy+292,'Domain imitates a trusted delivery service',30)
   box((225,yy+390,650,yy+472),'white',15)
   txt(260,yy+412,'Go back to safety',32,red)
   txt(700,yy+413,'View details',28,'#ffd6cd')
   if t>=5.5:
    # Evidence rail enters from the right, leaving warning text unobscured
    xx=1260+int(420*(1-ease((t-5.5)/.35)))
    box((xx,y+345,1720,y+595),navy,20)
    txt(xx+25,y+365,'WHY IT WAS FLAGGED',20,gold)
    txt(xx+25,y+415,'Look-alike domain',27)
    if t>=6.15: txt(xx+25,y+485,'Unusual payment',27); txt(xx+25,y+522,'request',27)
    d.line((xx+30,y+345,xx+30,y+55),fill=gold,width=3)
    d.ellipse((xx+22,y+47,xx+38,y+63),fill=gold)
   if 3<=t<3.2:
    region=im.crop((161,y+73,1759,y+620))
    im.paste(Image.blend(Image.new('RGB',region.size,red),region,a),(161,y+73))
 else:
  # A horizontal masked reveal settles completely at 8 seconds.
  u=ease((t-7.5)/.5)
  im=frame(7.49)
  end=Image.new('RGB',(W,H),navy); ed=ImageDraw.Draw(end)
  ed.ellipse((-440,-320,760,880),fill=green)
  ed.ellipse((1510,650,2180,1320),outline=gold,width=4)
  # Preserve the complete original image and its white background.
  a=logo.resize((660,660),Image.Resampling.LANCZOS); end.paste(a,(630,110))
  s='Spot the scam before it strikes.'; f=font(60); b=ed.textbbox((0,0),s,font=f)
  ed.text(((W-(b[2]-b[0]))/2,845),s,font=f,fill='white')
  im.paste(end.crop((0,0,int(W*u),H)),(0,0))
 return im

def audio():
 sr=48000; ts=np.arange(sr*10)/sr; a=np.zeros(len(ts))
 # Original soft harmonic bed, restrained rhythmic pulse and event tones.
 for hz in [110,164.81,220,277.18]:
  a+=.022*np.sin(2*np.pi*hz*ts)*np.minimum(ts/1.2,1)*np.clip((10-ts)/.7,0,1)
 for i in range(16):
  q=ts-i*.5; env=np.where(q>=0,np.exp(-np.maximum(q,0)*22),0)
  a+=.065*np.sin(2*np.pi*65*q)*env
 for start,hz in [(0.15,660),(1.76,1200),(3,220),(5.5,440),(6.15,554),(7.8,660),(7.95,830)]:
  q=ts-start; env=np.where(q>=0,np.exp(-np.maximum(q,0)*8),0)
  a+=.09*np.sin(2*np.pi*hz*q)*env
 with wave.open(str(P/'soundtrack.wav'),'wb') as w:
  w.setnchannels(1); w.setsampwidth(2); w.setframerate(sr); w.writeframes((np.clip(a,-1,1)*32767).astype('<i2').tobytes())

if __name__=='__main__':
 audio()
 cmd=['ffmpeg','-y','-f','rawvideo','-vcodec','rawvideo','-pix_fmt','rgb24','-s','1920x1080','-r','30','-i','-','-i',str(P/'soundtrack.wav'),'-c:v','libx264','-preset','fast','-crf','18','-pix_fmt','yuv420p','-c:a','aac','-b:a','192k','-t','10','-movflags','+faststart',str(P/'SAQR-pitch.mp4')]
 p=subprocess.Popen(cmd,stdin=subprocess.PIPE,stderr=open(P/'render.log','w'))
 for i in range(300):
  im=frame(i/30); p.stdin.write(im.tobytes())
  if i in [0,44,60,89,96,150,180,224,240,299]: im.save(P/f'frame-{i:03}.jpg')
  if i==120: im.save(P/'thumbnail.png')
 p.stdin.close(); assert p.wait()==0
 print('Rendered 300 frames with original audio.')
