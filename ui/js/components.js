// FortenLog UI Components

export function createIcon(id, size = 16) {
    return `<svg style="width: ${size}px; height: ${size}px;"><use href="#icon-${id}"></use></svg>`;
}

export function BarChart(data, options = {}) {
    if (!data || data.length === 0) return '<div class="no-data" style="text-align:center; padding: 40px; color:var(--text-secondary);">NO_DATA_AVAILABLE</div>';
    
    const max = Math.max(...data.map(d => d.count)) || 1;
    const height = options.height || 150;
    
    return `
        <div class="bar-chart" style="height: ${height}px; display: flex; align-items: flex-end; gap: 8px; padding-top: 20px;">
            ${data.map(d => {
                const h = (d.count / max) * (height - 30);
                return `
                    <div class="bar-container" style="flex: 1; display: flex; flex-direction: column; align-items: center; gap: 8px;">
                        <div class="bar-value" style="font-size: 10px; font-weight: 800; color: var(--accent);">${d.count}</div>
                        <div class="bar" title="${d.name}: ${d.count}" style="width: 100%; height: ${h}px; background: var(--accent); border-radius: 4px 4px 0 0; opacity: 0.8; transition: all 0.3s ease;"></div>
                        <div class="bar-label" style="font-size: 10px; color: var(--text-secondary); white-space: nowrap; overflow: hidden; text-overflow: ellipsis; width: 100%; text-align: center;">${d.name}</div>
                    </div>
                `;
            }).join('')}
        </div>
    `;
}

export function DonutChart(data, options = {}) {
    if (!data || data.length === 0) return '<div class="no-data" style="text-align:center; padding: 40px; color:var(--text-secondary);">NO_DATA_AVAILABLE</div>';
    
    const total = data.reduce((acc, d) => acc + d.count, 0);
    const size = options.size || 150;
    const strokeWidth = 20;
    const radius = (size - strokeWidth) / 2;
    const circumference = 2 * Math.PI * radius;
    
    let currentOffset = 0;
    const colors = ['#6c5ce7', '#a29bfe', '#81ecec', '#fab1a0', '#ff7675'];
    
    const paths = data.map((d, i) => {
        const percentage = d.count / total;
        const dashArray = `${percentage * circumference} ${circumference}`;
        const offset = currentOffset;
        currentOffset -= percentage * circumference;
        
        return `
            <circle cx="${size/2}" cy="${size/2}" r="${radius}" 
                fill="none" 
                stroke="${colors[i % colors.length]}" 
                stroke-width="${strokeWidth}" 
                stroke-dasharray="${dashArray}" 
                stroke-dashoffset="${offset}"
                transform="rotate(-90 ${size/2} ${size/2})"
                style="transition: all 0.5s ease;">
            </circle>
        `;
    }).join('');
    
    return `
        <div style="display: flex; align-items: center; gap: 20px;">
            <svg width="${size}" height="${size}" style="flex-shrink: 0; min-width: ${size}px;">
                ${paths}
                <text x="50%" y="50%" text-anchor="middle" dy=".3em" fill="var(--text-primary)" font-weight="900" font-size="20">${total}</text>
            </svg>
            <div class="chart-legend" style="display: flex; flex-direction: column; gap: 8px;">
                ${data.map((d, i) => `
                    <div style="display: flex; align-items: center; gap: 8px; font-size: 11px;">
                        <div style="width: 10px; height: 10px; border-radius: 2px; background: ${colors[i % colors.length]};"></div>
                        <span style="color: var(--text-secondary); font-weight: 600;">${d.name}</span>
                        <span style="color: var(--text-primary); font-weight: 800;">${Math.round(d.count/total*100)}%</span>
                    </div>
                `).join('')}
            </div>
        </div>
    `;
}
export function loader() {
    return `
        <div style="display: flex; flex-direction: column; align-items: center; justify-content: center; height: 100%; min-height: 400px; gap: 20px;">
            <div class="loader"></div>
            <div style="font-size: 14px; font-weight: 800; color: var(--accent); letter-spacing: 1px;">LOADING_DATA</div>
        </div>
    `;
}

export const components = {
    createIcon,
    BarChart,
    DonutChart,
    loader,
    WorldMap
};

import { worldMapSvg } from './worldMapSvg.js';

const countryNames = {
    'us': 'United States',
    'ru': 'Russia',
    'de': 'Germany',
    'cn': 'China',
    'gb': 'United Kingdom',
    'fr': 'France',
    'jp': 'Japan',
    'ca': 'Canada',
    'in': 'India',
    'br': 'Brazil',
    'au': 'Australia',
    'ua': 'Ukraine',
    'kz': 'Kazakhstan',
    'by': 'Belarus',
    'nl': 'Netherlands',
    'it': 'Italy',
    'es': 'Spain',
    'ch': 'Switzerland',
    'se': 'Sweden',
    'no': 'Norway',
    'fi': 'Finland',
    'dk': 'Denmark',
    'pl': 'Poland',
    'tr': 'Turkey',
    'sa': 'Saudi Arabia',
    'ae': 'United Arab Emirates',
    'sg': 'Singapore',
    'za': 'South Africa',
    'mx': 'Mexico',
    'kr': 'South Korea'
};

export function WorldMap(data, options = {}) {
    if (!data || data.length === 0) return '<div class="no-data" style="text-align:center; padding: 40px; color:var(--text-secondary);">NO_DATA_AVAILABLE</div>';
    
    const total = data.reduce((acc, d) => acc + d.count, 0) || 1;
    const max = Math.max(...data.map(d => d.count)) || 1;
    
    const parser = new DOMParser();
    const doc = parser.parseFromString(worldMapSvg, 'image/svg+xml');
    const svgEl = doc.querySelector('svg');
    
    if (svgEl) {
        // Remove global title to avoid default fallback tooltip
        const globalTitle = svgEl.querySelector('title');
        if (globalTitle) {
            globalTitle.remove();
        }
        
        const dataMap = new Map(data.map(d => [(d.name || '').toLowerCase(), d]));
        
        svgEl.querySelectorAll('path[id], g[id]').forEach(el => {
            const id = el.getAttribute('id');
            if (!id || id === 'world-map') return;
            
            const countryCode = id.toLowerCase();
            const countryName = countryNames[countryCode] || id.toUpperCase();
            
            const d = dataMap.get(countryCode);
            const titleEl = doc.createElementNS('http://www.w3.org/2000/svg', 'title');
            
            if (d) {
                const pct = Math.round((d.count / total) * 100);
                titleEl.textContent = `${countryName}: ${d.count} (${pct}%)`;
                
                // Use logarithmic scaling so smaller regions are still visible even if one country dominates
                const maxLog = Math.log(max + 1);
                const valLog = Math.log(d.count + 1);
                const intensity = 0.2 + (0.8 * (valLog / maxLog));
                const fillColor = `rgba(108, 92, 231, ${intensity})`;
                
                const styleStr = `fill: ${fillColor} !important; stroke: rgba(255,255,255,0.2); stroke-width: 1px;`;
                el.setAttribute('style', styleStr);
                
                if (el.tagName.toLowerCase() === 'g') {
                    el.querySelectorAll('path').forEach(childPath => {
                        childPath.setAttribute('style', styleStr);
                    });
                }
            } else {
                titleEl.textContent = countryName;
            }
            
            el.appendChild(titleEl);
        });
    }
    
    const svgStr = svgEl ? new XMLSerializer().serializeToString(svgEl) : worldMapSvg;
    const sorted = [...data].sort((a, b) => b.count - a.count).slice(0, 6);

    const legendHtml = sorted.map(d => {
        const countryCode = d.name.toLowerCase();
        const name = countryNames[countryCode] || d.name.toUpperCase();
        const pct = Math.round((d.count / total) * 100);
        const maxLog = Math.log(max + 1);
        const valLog = Math.log(d.count + 1);
        const intensity = 0.2 + (0.8 * (valLog / maxLog));
        const color = `rgba(108, 92, 231, ${intensity})`;
        return `
            <div style="display: flex; align-items: center; gap: 8px; font-size: 11px; background: var(--bg-sub); padding: 4px 10px; border-radius: 6px; border: 1px solid var(--border);">
                <span style="width: 8px; height: 8px; border-radius: 50%; background: ${color}; display: inline-block;"></span>
                <span style="font-weight: 700; color: var(--text-primary);">${name}</span>
                <span style="color: var(--text-secondary); font-weight: 600;">${d.count} (${pct}%)</span>
            </div>
        `;
    }).join('');
    
    return `<div style="display: flex; flex-direction: column; height: 100%; justify-content: space-between; gap: 16px;">
        <div class="world-map-container" style="flex: 1; display: flex; align-items: center; justify-content: center; overflow: hidden; min-height: 0;">
            <style>
                #world-map { width: 100%; height: 100%; max-width: 100%; max-height: 100%; }
                #world-map path { fill: rgba(128,128,128,0.1); stroke: rgba(255,255,255,0.15); stroke-width: 0.5px; transition: fill 0.3s ease; }
                #world-map path:hover { fill: rgba(108, 92, 231, 0.6) !important; cursor: pointer; stroke: rgba(255,255,255,0.4); stroke-width: 1px; }
            </style>
            ${svgStr}
        </div>
        <div class="world-map-legend" style="display: flex; flex-wrap: wrap; gap: 8px; justify-content: center; padding-top: 12px; border-top: 1px solid var(--border);">
            ${legendHtml}
        </div>
    </div>`;
}
