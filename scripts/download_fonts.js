const fs = require('fs');
const path = require('path');
const https = require('https');

const FONTS_DIR = path.join(__dirname, '../ui/fonts');
if (!fs.existsSync(FONTS_DIR)) {
    fs.mkdirSync(FONTS_DIR, { recursive: true });
}

const fontUrl = 'https://fonts.googleapis.com/css2?family=Roboto+Mono:wght@400;600&family=Inter:wght@400;600;800&display=swap';

// Use a Chrome User-Agent so Google Fonts returns .woff2 files
const options = {
    headers: {
        'User-Agent': 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/120.0.0.0 Safari/537.36'
    }
};

console.log('Fetching CSS from Google Fonts...');
https.get(fontUrl, options, (res) => {
    let css = '';
    res.on('data', (chunk) => css += chunk);
    res.on('end', async () => {
        // Find all font URLs
        const regex = /url\((https:\/\/[^)]+)\)/g;
        let match;
        const urls = [];
        while ((match = regex.exec(css)) !== null) {
            urls.push(match[1]);
        }

        console.log(`Found ${urls.length} font files to download...`);

        // We will download each font file and replace its URL in the CSS
        let localCss = css;

        for (let i = 0; i < urls.length; i++) {
            const url = urls[i];
            const ext = '.woff2';
            const filename = `font-${i}${ext}`;
            const destPath = path.join(FONTS_DIR, filename);

            console.log(`Downloading (${i + 1}/${urls.length}): ${url} -> ${destPath}...`);
            try {
                await downloadFile(url, destPath);
                // Replace in CSS
                localCss = localCss.replaceAll(url, `/fonts/${filename}`);
            } catch (err) {
                console.error(`Failed to download ${url}`, err);
            }
        }

        // Save local CSS to ui/css/fonts.css
        const cssPath = path.join(__dirname, '../ui/css/fonts.css');
        fs.writeFileSync(cssPath, localCss);
        console.log(`\n[SUCCESS] Successfully generated local fonts stylesheet at ${cssPath}`);
        console.log('All font files downloaded to ui/fonts/ and embedded in the static bundle.');
    });
}).on('error', (err) => {
    console.error('Failed to fetch font CSS from Google Fonts', err);
});

function downloadFile(url, dest) {
    return new Promise((resolve, reject) => {
        const file = fs.createWriteStream(dest);
        https.get(url, (res) => {
            res.pipe(file);
            file.on('finish', () => {
                file.close(resolve);
            });
        }).on('error', (err) => {
            fs.unlink(dest, () => {});
            reject(err);
        });
    });
}
