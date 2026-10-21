const { app, nativeImage } = require('electron');
app.whenReady().then(() => {
  const emptyImg = nativeImage.createEmpty();
  console.log('nativeImage OK, createEmpty size:', emptyImg.getSize());
  app.quit();
});
