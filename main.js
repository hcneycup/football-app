
const { app, BrowserWindow, ipcMain } = require('electron');
const path = require('path');

require('dotenv').config();

let mainWindow;

ipcMain.handle('get-api-key', () => {
    return process.env.API_KEY;
});

function createWindow() {
    mainWindow = new BrowserWindow({
        width: 450,
        height: 350,
        title: "Daily Football Tracker",
        webPreferences: {
            nodeIntegration: true,
            contextIsolation: false
        },
        titleBarStyle: 'default',
        resizable: true,
        show: false
    });

    mainWindow.loadFile('index.html');

    mainWindow.once('ready-to-show', () => {
        mainWindow.show();
    });

    mainWindow.on('closed', () => {
        mainWindow = null;
    });
}

app.whenReady().then(createWindow);

app.on('window-all-closed', () => {
    if (process.platform !== 'darwin') {
        app.quit();
    }
});

app.on('activate', () => {
    if (BrowserWindow.getAllWindows().length === 0) {
        createWindow();
    }
});


