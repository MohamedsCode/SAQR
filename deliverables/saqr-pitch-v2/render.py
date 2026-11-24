from PIL import Image,ImageDraw,ImageFont
import numpy as np, subprocess,wave
from pathlib import Path
P=Path(__file__).parent
W,H=1920,1080
N='#0b2032'; M='#d5efcf'; G='#166349'; A='#ffbe45'; R='#bc2537'
logo=Image.open(P/'logo-transparent.png').convert('RGBA')
def e(x): return 1-(1-max(0,min(1,x)))**4
def f(n,b=True): return ImageFont.truetype('C:/Windows/Fonts/'+('arialbd.ttf' if b else 'arial.ttf'),n)
def text(im,xy,s,n=60,c=N): ImageDraw.Draw(im).text(xy,s,font=f(n),fill=c)
def rr(im,xy,c,r=30): ImageDraw.Draw(im).rounded_rectangle(xy,radius=r,fill=c)
def place(im,layer,cx,cy,scale=1,angle=0):
 layer=layer.resize((max(1,int(layer.width*scale)),max(1,int(layer.height*scale))),Image.Resampling.BICUBIC).rotate(angle,resample=Image.Resampling.BICUBIC,expand=True)
 im.paste(layer,(int(cx-layer.width/2),int(cy-layer.height/2)),layer)
def frame(t):
 im=Image.new('RGB',(W,H),M);d=ImageDraw.Draw(im)
 if t<2.65:
  # Large editorial hook with independently animated words and tilted notification.
  d.rectangle((0,0,780,H),fill=N)
  text(im,(90,80),'SAQR /',40,M)
  for j,s in enumerate(['One','click.']):
   q=e((t-j*.12)/.55); text(im,(90-int(500*(1-q)),300+j*175),s,155,M if j==0 else A)
  card=Image.new('RGBA',(990,680));rr(card,(0,0,989,679),'#fffef9',40)
  text(card,(65,55),'PARCEL EXPRESS',34,G)
  text(card,(65,145),'Delivery on hold.',66)
  text(card,(65,240),'Confirm your address.',43)
  text(card,(65,320),'AED 4.99',92)
  press=max(0,1-abs(t-1.75)/.13)
  rr(card,(65+press*4,480+press*4,925-press*4,600-press*4),G,20)
  text(card,(340,508),'Continue',48,'white')
  q=e(t/.65);cx=1290+380*(1-q);cy=540+30*np.sin(t*1.5)
  place(im,card,cx,cy, .95+.025*t, -5+3*e(t/2))
  if t>1:
   q=e((t-1)/.65);cx=1780-460*q;cy=1030-265*q
   d.polygon([(cx,cy),(cx+15,cy+83),(cx+35,cy+59),(cx+65,cy+55)],fill=N,outline='white',width=4)
   if 1.7<t<2.05:
    rad=20+160*(t-1.7);d.ellipse((cx-rad,cy-rad,cx+rad,cy+rad),outline=G,width=5)
  if t>2.1:
   # Payment amount becomes a full-screen amber wipe.
   q=e((t-2.1)/.55);xx=int(W*(1-q));d.rectangle((xx,0,W,H),fill=A)
   text(im,(xx+120,190),'Real',150);text(im,(xx+120,355),'consequences.',150)
   text(im,(xx+130,650),'A small payment. A convincing trap.',54)
 elif t<4.05:
  im=Image.new('RGB',(W,H),A);d=ImageDraw.Draw(im)
  q=e((t-2.65)/.6)
  text(im,(120,105-int(45*q)),'Real consequences.',125)
  panel=Image.new('RGBA',(1680,410));rr(panel,(0,0,1679,409),N,35)
  text(panel,(65,55),'LOOK CLOSER',36,A)
  text(panel,(65,150),'parcel-confirm.example',92,'white')
  d2=ImageDraw.Draw(panel);d2.line((65,278,65+int(1150*e((t-2.8)/.5)),278),fill=A,width=9)
  text(panel,(65,315),'A look-alike delivery link',44,'#d5efcf')
  place(im,panel,960,620, .88+.12*q,1.5*(1-q))
  if t>3.65:
   r=int(2300*e((t-3.65)/.4));d.ellipse((960-r,540-r,960+r,540+r),fill=R)
 elif t<7.6:
  im=Image.new('RGB',(W,H),R);d=ImageDraw.Draw(im)
  q=e((t-4.05)/.35)
  # Browser chrome and typography become a unified warning scene.
  rr(im,(90,50,1830,135),'#97192a',25)
  text(im,(140,70),'SAQR',37,'white');text(im,(610,73),'parcel-confirm.example',37,'#ffc6bb')
  y=225+int(80*(1-q))
  text(im,(120,y),'This site may',122,'white')
  text(im,(120,y+145),'be fraudulent.',122,'white')
  # Warning symbol enters from the right and turns into a safety arrow.
  sx=1550+400*(1-q)
  d.polygon([(sx,230),(sx-160,520),(sx+160,520)],outline='#ffcead',width=13)
  text(im,(sx-18,330),'!',110,'#ffcead')
  text(im,(125,570),'A trusted name. An untrusted domain.',48,'#ffdbd4')
  rr(im,(120,760,800,900),'white',24)
  text(im,(170,792),'Go back to safety',55,R)
  if t>5.25:
   a=e((t-5.25)/.4);xx=int(1920-960*a)
   rr(im,(xx,720,xx+840,930),N,25)
   text(im,(xx+45,750),'Look-alike domain',48,M)
   if t>6:
    a=e((t-6)/.3);text(im,(xx+45+int(80*(1-a)),830),'Unexpected payment request',38,'white')
  # Slow cinematic reframing keeps the shot alive without shaking text.
  z=1+.012*(t-4.05);big=im.resize((int(W*z),int(H*z)),Image.Resampling.BICUBIC)
  im=big.crop(((big.width-W)//2,(big.height-H)//2,(big.width+W)//2,(big.height+H)//2))
 else:
  # Coordinated diagonal wipe into a large, transparent logo lockup.
  im=Image.new('RGB',(W,H),M);d=ImageDraw.Draw(im)
  d.polygon([(0,0),(660,0),(340,H),(0,H)],fill='#b6d8ae')
  d.polygon([(1760,0),(1920,0),(1920,H),(1440,H)],fill='#c4e4bc')
  q=e((t-7.6)/.4)
  place(im,logo,510,520, .61*q)
  text(im,(1010,310),'Spot the scam',88)
  text(im,(1010,425),'before',88)
  text(im,(1010,540),'it strikes.',106,G)
  d.line((1015,710,1015+int(650*q),710),fill=G,width=8)
  if t<8:
   x=int(W*q);d.polygon([(x,0),(W,0),(W,H),(x+380,H)],fill=R)
 return im

def audio():
 sr=48000;ts=np.arange(sr*10)/sr;a=np.zeros(len(ts));rng=np.random.default_rng(7)
 for hz in [110,164.81,220]: a+=.018*np.sin(2*np.pi*hz*ts)*np.minimum(ts/.4,1)*np.clip((10-ts)/.5,0,1)
 for start in np.arange(0,8,.375):
  q=np.maximum(ts-start,0);mask=ts>=start
  a+=mask*.16*np.sin(2*np.pi*(48*q+2*(1-np.exp(-q*22))))*np.exp(-q*22)
  a+=mask*.025*rng.normal(size=len(ts))*np.exp(-q*65)
 for start,hz in [(0,660),(1.73,1300),(2.1,330),(2.7,440),(4.05,165),(5.25,554),(6,660),(7.6,440),(7.75,554),(7.9,830)]:
  q=np.maximum(ts-start,0);a+=(ts>=start)*.065*np.sin(2*np.pi*hz*q)*np.exp(-q*7)
 for start in [2.1,3.65,7.6]:
  q=(ts-start)/.35;env=np.where((q>=0)&(q<1),np.sin(np.pi*np.clip(q,0,1))**2,0)
  noise=rng.normal(size=len(ts));noise=np.convolve(noise,np.ones(18)/18,mode='same');a+=.16*noise*env
 with wave.open(str(P/'soundtrack.wav'),'wb') as w:
  w.setnchannels(1);w.setsampwidth(2);w.setframerate(sr);w.writeframes((np.clip(a,-1,1)*32767).astype('<i2').tobytes())
if __name__=='__main__':
 audio();p=subprocess.Popen(['ffmpeg','-y','-f','rawvideo','-pix_fmt','rgb24','-s','1920x1080','-r','30','-i','-','-i',str(P/'soundtrack.wav'),'-c:v','libx264','-preset','fast','-crf','17','-pix_fmt','yuv420p','-c:a','aac','-b:a','192k','-t','10','-movflags','+faststart',str(P/'SAQR-pitch-v2.mp4')],stdin=subprocess.PIPE,stderr=open(P/'render.log','w'))
 for i in range(300):
  im=frame(i/30);p.stdin.write(im.tobytes())
  if i in [15,45,75,90,120,135,165,195,225,240,299]: im.save(P/f'frame-{i:03}.jpg')
  if i==150: im.save(P/'thumbnail.png')
 p.stdin.close();assert p.wait()==0
 print('Rendered v2: 300 frames.')
