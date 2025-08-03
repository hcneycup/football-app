// Football Break App - Final Version
const { ipcRenderer } = require('electron');
let matchesData = [];
let autoRefreshInterval;
const competitions = ['PL', 'BL1', 'PD', 'CL', 'BSA'];

// API Key from football-data.org
let API_KEY;

async function initializeApp() {
    try {
        API_KEY = await ipcRenderer.invoke('get-api-key');
        await loadTodaysMatches();
        setupUI();
        startAutoRefresh();
    } catch (error) {
        console.error('Failed to get API key:', error);
        showNoMatchesMessage();
    }
}
// Add these variables at the top of your file (outside any functions)
let lastFetchTime = 0;
let cachedMatches = [];
const CACHE_DURATION = 120000; // 2 minutes in milliseconds

// Helper function to check if there are live matches
function hasLiveMatches(matches) {
    return matches.some(match =>
        match.status === 'IN_PLAY' ||
        match.status === 'PAUSED' ||
        match.status === 'LIVE' ||
        match.status === 'HALF_TIME'
    );
}

async function loadTodaysMatches() {
    const today = new Date().toISOString().split('T')[0];
    const now = Date.now();

    // Only use cached data if:
    // 1. Cache is recent AND
    // 2. There are NO live matches (to avoid missing live updates)
    const shouldUseCache = cachedMatches.length > 0 &&
        (now - lastFetchTime) < CACHE_DURATION &&
        !hasLiveMatches(cachedMatches);

    if (shouldUseCache) {
        console.log('Using cached data (no live matches)');
        hideNoMatchesMessage();
        displayMatches(cachedMatches);
        updateLastUpdatedTime();
        return;
    }

    hideNoMatchesMessage();

    let totalMatches = 0;
    let allMatches = [];
    let hasRateLimit = false;

    for (const comp of competitions) {
        try {
            const url = `https://api.football-data.org/v4/competitions/${comp}/matches?dateFrom=${today}&dateTo=${today}`;

            const res = await fetch(url, {
                headers: { 'X-Auth-Token': API_KEY }
            });

            if (res.status === 429) {
                console.log('Rate limit reached for competition:', comp);
                hasRateLimit = true;
                continue; // Skip this competition but continue with others
            }

            if (!res.ok) {
                const errorText = await res.text();
                console.error('API Error:', res.status, errorText);
                throw new Error(`Error: ${res.status}`);
            }

            const data = await res.json();
            const todayMatches = data.matches;

            if (todayMatches && todayMatches.length > 0) {
                allMatches = allMatches.concat(todayMatches);
                totalMatches += todayMatches.length;
            }

        } catch (err) {
            console.error('Error loading matches:', err);
        }
    }

    // If we got new data, update cache and display
    if (totalMatches > 0) {
        cachedMatches = allMatches;
        lastFetchTime = now;
        displayMatches(allMatches);
        console.log('Displaying fresh data');
    }
    // If we hit rate limits but have cached data, use it
    else if (hasRateLimit && cachedMatches.length > 0) {
        console.log('Rate limited - displaying cached matches');
        displayMatches(cachedMatches);
    }
    // If no new data and no cached data, show no matches
    else if (cachedMatches.length === 0) {
        showNoMatchesMessage();
    }
    // If we have cached data but no new data (and no rate limit), keep showing cached
    else {
        displayMatches(cachedMatches);
    }

    updateLastUpdatedTime();
}

function showNoMatchesMessage() {
    const wrapper = document.getElementById('noMatchesWrapper');
    if (wrapper) {
        wrapper.style.display = 'flex';
        requestAnimationFrame(() => {
            wrapper.classList.add('show');
        });
    }
}

function hideNoMatchesMessage() {
    const wrapper = document.getElementById('noMatchesWrapper');
    const popup = document.getElementById('noMatchesMessage');

    if (wrapper) {
        wrapper.classList.remove('show');
        setTimeout(() => {
            wrapper.style.display = 'none';
        }, 300);
    }
    if (popup) popup.style.display = 'none';
}

function displayMatches(matches, isYesterday = false) {
    const container = document.querySelector('.matches-container');
    const popupWrapper = document.getElementById('noMatchesWrapper');
    const popup = document.getElementById('noMatchesMessage');
    const loading = document.getElementById('loadingMessage');

    if (popupWrapper) popupWrapper.style.display = 'none';
    if (popup) popup.style.display = 'none';
    if (loading) loading.style.display = 'none';

    container.innerHTML = '';

    let html = '';

    if (isYesterday) {
        html += `<div class="yesterday-header"><span class="yesterday-badge">Yesterday's Results</span></div>`;
    }

    matches.forEach(match => {
        const home = match.homeTeam.name;
        const away = match.awayTeam.name;
        const homeScore = match.score?.fullTime?.home ?? '-';
        const awayScore = match.score?.fullTime?.away ?? '-';
        const comp = match.competition.name;

        const kickoff = new Date(match.utcDate).toLocaleTimeString('en-GB', {
            hour: '2-digit',
            minute: '2-digit'
        });

        let statusText;
        let statusClass;

        switch (match.status) {
            case 'IN_PLAY':
                statusText = 'LIVE';
                statusClass = 'live';
                break;
            case 'PAUSED':
                statusText = 'HT';
                statusClass = 'paused';
                break;
            case 'FINISHED':
                statusText = 'FT';
                statusClass = 'finished';
                break;
            default:
                statusText = kickoff;
                statusClass = 'scheduled';
        }

        html += `
            <div class="match-card ${statusClass}" onclick="showMatchDetails('${home}', '${away}', '${comp}')">
                <div class="match-header">
                    <span class="competition">${comp}</span>
                    <span class="match-status ${statusClass}">${statusText}</span>
                </div>
                <div class="match-teams">
                    <div class="team">
                        <div class="team-info">
                            ${getTeamLogo(home, match.competition.code)}
                            <span class="team-name">${home}</span>
                        </div>
                    </div>
                    <div class="match-score">
                        ${homeScore} – ${awayScore}
                    </div>
                    <div class="team">
                        <div class="team-info">
                            ${getTeamLogo(away, match.competition.code)}
                            <span class="team-name">${away}</span>
                        </div>
                    </div>
                </div>
            </div>
        `;
    });

    container.innerHTML = html;
}

const clubLogos = {
    'Man United': '<img src="https://upload.wikimedia.org/wikipedia/hif/f/ff/Manchester_United_FC_crest.png" class="team-icon">',
    'Liverpool': '<img src="https://upload.wikimedia.org/wikipedia/hif/b/bd/Liverpool_FC.png" class="team-icon">',
    'Arsenal': '<img src="https://upload.wikimedia.org/wikipedia/hif/8/82/Arsenal_FC.png" class="team-icon">',
    'Man City': '<img src="https://upload.wikimedia.org/wikipedia/en/thumb/e/eb/Manchester_City_FC_badge.svg/1200px-Manchester_City_FC_badge.svg.png" alt="Manchester City" class="team-icon">',
    'Tottenham': '<img src="https://brandlogos.net/wp-content/uploads/2014/10/tottenham-hotspur-fc-logo-300x300.png" alt="Tottenham Hotspur" class="team-icon">',
    'Real Madrid': '<img src="https://upload.wikimedia.org/wikipedia/sco/thumb/5/56/Real_Madrid_CF.svg/1200px-Real_Madrid_CF.svg.png" alt="Real Madrid" class="team-icon">',
    'Barça': '<img src="https://upload.wikimedia.org/wikipedia/en/thumb/4/47/FC_Barcelona_%28crest%29.svg/1200px-FC_Barcelona_%28crest%29.svg.png" alt="Barcelona FC" class="team-icon">',
    'Valencia': '<img src="https://upload.wikimedia.org/wikipedia/en/thumb/c/ce/Valenciacf.svg/1200px-Valenciacf.svg.png" alt="Valencia FC" class="team-icon">',
    'Bayern': '<img src="https://upload.wikimedia.org/wikipedia/commons/thumb/1/1b/FC_Bayern_M%C3%BCnchen_logo_%282017%29.svg/2048px-FC_Bayern_M%C3%BCnchen_logo_%282017%29.svg.png" alt="Bayern Munich" class="team-icon">',
    'Dortmund': '<img src="https://upload.wikimedia.org/wikipedia/commons/7/74/Borussia_Dortmund.png" alt="Borussia Dortmund" class="team-icon">',
    'RB Leipzig': '<img src="https://upload.wikimedia.org/wikipedia/en/thumb/0/04/RB_Leipzig_2014_logo.svg/1200px-RB_Leipzig_2014_logo.svg.png" alt="RB LeipZig" class="team-icon">',
    'Juventus': '<img src="https://upload.wikimedia.org/wikipedia/commons/5/51/Juventus_FC_2017_logo.png" alt="Juventus FC" class="team-icon">',
    'Milan': '<img src="https://upload.wikimedia.org/wikipedia/commons/thumb/d/d0/Logo_of_AC_Milan.svg/1306px-Logo_of_AC_Milan.svg.png" alt="AC Milan" class="team-icon">',
    'Inter': '<img src="https://upload.wikimedia.org/wikipedia/commons/thumb/0/05/FC_Internazionale_Milano_2021.svg/2048px-FC_Internazionale_Milano_2021.svg.png" alt="Inter Milan" class="team-icon">',
    'AS Roma': '<img src="https://upload.wikimedia.org/wikipedia/en/thumb/f/f7/AS_Roma_logo_%282017%29.svg/1200px-AS_Roma_logo_%282017%29.svg.png" alt="AS Roma" class="team-icon">',
    'PSG': '<img src="https://upload.wikimedia.org/wikipedia/en/thumb/a/a7/Paris_Saint-Germain_F.C..svg/1200px-Paris_Saint-Germain_F.C..svg.png" alt="Paris Saint-Germain" class="team-icon">',
    'SC Recife': '<img src="https://upload.wikimedia.org/wikipedia/en/thumb/4/45/Sport_Club_Recife.svg/1200px-Sport_Club_Recife.svg.png" alt="SC Recife" class="team-icon">',
    'EC Bahia': '<img src="https://upload.wikimedia.org/wikipedia/en/thumb/2/2c/Esporte_Clube_Bahia_logo.svg/1200px-Esporte_Clube_Bahia_logo.svg.png" alt="EC Bahia" class="team-icon">',
    'Mirassol FC': '<img src="https://upload.wikimedia.org/wikipedia/commons/5/5b/Mirassol_FC_logo.png" alt="Mirassol FC" class="team-icon">',
    'CR Vasco da Gama': '<img src="https://upload.wikimedia.org/wikipedia/en/0/03/CR_Vasco_da_Gama_2021_logo.png" alt="CR Vasco da Gama" class="team-icon">',
    'Fluminense FC': '<img src="https://upload.wikimedia.org/wikipedia/commons/a/ad/Fluminense_FC_escudo.png" alt="Fluminense FC" class="team-icon">',
    'Grêmio FBPA': '<img src="https://upload.wikimedia.org/wikipedia/commons/thumb/0/08/Gremio_logo.svg/1200px-Gremio_logo.svg.png" alt="Grêmio FBPA" class="team-icon">',
    'Aston Villa': '<img src="https://logodownload.org/wp-content/uploads/2019/10/aston-villa-logo.png" alt="Aston Villa" class="team-icon">',
    'Leverkusen': '<img src="https://upload.wikimedia.org/wikipedia/en/thumb/5/59/Bayer_04_Leverkusen_logo.svg/1200px-Bayer_04_Leverkusen_logo.svg.png" alt="Leverkusen" class="team-icon">',
    'Newcastle': '<img src="https://upload.wikimedia.org/wikipedia/hif/2/25/Newcastle_United_Logo.png" alt="Newcastle" class="team-icon">',
    'Chelsea': '<img src="https://upload.wikimedia.org/wikipedia/sco/thumb/c/cc/Chelsea_FC.svg/1200px-Chelsea_FC.svg.png" alt="Chelsea" class="team-icon">',
    'Nottingham': '<img src="https://upload.wikimedia.org/wikipedia/sco/thumb/d/d2/Nottingham_Forest_logo.svg/1200px-Nottingham_Forest_logo.svg.png" alt="Nottingham" class="team-icon">',
    'Brighton Hove': '<img src="https://upload.wikimedia.org/wikipedia/sco/thumb/f/fd/Brighton_%26_Hove_Albion_logo.svg/1200px-Brighton_%26_Hove_Albion_logo.svg.png" alt="Brighton Hove" class="team-icon">',
    'Bournemouth': '<img src="https://upload.wikimedia.org/wikipedia/hif/5/53/AFC_Bournemouth_%282013%29.png" alt="Bournemouth" class="team-icon">',
    'Brentford': '<img src="https://upload.wikimedia.org/wikipedia/en/thumb/2/2a/Brentford_FC_crest.svg/1200px-Brentford_FC_crest.svg.png" alt="Brentford" class="team-icon">',
    'Fulham': '<img src="https://upload.wikimedia.org/wikipedia/en/thumb/e/eb/Fulham_FC_%28shield%29.svg/1200px-Fulham_FC_%28shield%29.svg.png" alt="Fulham" class="team-icon">',
    'Crystal Palace': '<img src="https://upload.wikimedia.org/wikipedia/hif/c/c1/Crystal_Palace_FC_logo.png" alt="Crystal Palace" class="team-icon">',
    'Everton': '<img src="https://upload.wikimedia.org/wikipedia/sco/thumb/7/7c/Everton_FC_logo.svg/1200px-Everton_FC_logo.svg.png" alt="Everton" class="team-icon">',
    'West Ham': '<img src="https://upload.wikimedia.org/wikipedia/sco/thumb/c/c2/West_Ham_United_FC_logo.svg/1200px-West_Ham_United_FC_logo.svg.png" alt="West Ham" class="team-icon">',
    'Wolverhampton': '<img src="https://upload.wikimedia.org/wikipedia/sco/thumb/f/fc/Wolverhampton_Wanderers.svg/1200px-Wolverhampton_Wanderers.svg.png" alt="Wolverhampton" class="team-icon">',
    'Leicester City': '<img src="https://upload.wikimedia.org/wikipedia/hif/a/ab/Leicester_City_crest.png" alt="Leicester City" class="team-icon">',
    'Ipswich Town': '<img src="https://upload.wikimedia.org/wikipedia/en/thumb/4/43/Ipswich_Town.svg/1200px-Ipswich_Town.svg.png" alt="Ipswich Town" class="team-icon">',
    'Southampton': '<img src="https://upload.wikimedia.org/wikipedia/hif/8/85/FC_Southampton.png" alt="Southampton" class="team-icon">'
};

const countryFlags = {
    'Spain': '<img src="https://upload.wikimedia.org/wikipedia/commons/thumb/9/9a/Flag_of_Spain.svg/2560px-Flag_of_Spain.svg.png" alt="Spain" class="team-icon">',
    'England': '<img src="https://upload.wikimedia.org/wikipedia/commons/thumb/b/be/Flag_of_England.svg/2560px-Flag_of_England.svg.png" alt="England" class="team-icon">',
    'France': '<img src="https://upload.wikimedia.org/wikipedia/commons/6/62/Flag_of_France.png" alt="France" class="team-icon">',
    'Germany': '<img src="https://upload.wikimedia.org/wikipedia/commons/thumb/b/ba/Flag_of_Germany.svg/2560px-Flag_of_Germany.svg.png" alt="Germany" class="team-icon">',
    'Netherlands': '<img src="https://upload.wikimedia.org/wikipedia/commons/b/b2/Flag_of_the_Netherlands.png" alt="Netherlands" class="team-icon">',
    'Portugal': '<img src="https://upload.wikimedia.org/wikipedia/commons/thumb/5/5c/Flag_of_Portugal.svg/2560px-Flag_of_Portugal.svg.png" alt="Portugal" class="team-icon">',
    'Turkey': '<img src="https://upload.wikimedia.org/wikipedia/commons/thumb/b/b4/Flag_of_Turkey.svg/2560px-Flag_of_Turkey.svg.png" alt="Turkey" class="team-icon">',
    'Switzerland': '<img src="https://upload.wikimedia.org/wikipedia/commons/thumb/f/f3/Flag_of_Switzerland.svg/2048px-Flag_of_Switzerland.svg.png" alt="Switzerland" class="team-icon">',
    'Austria': '<img src="https://upload.wikimedia.org/wikipedia/commons/thumb/4/41/Flag_of_Austria.svg/1280px-Flag_of_Austria.svg.png" alt="Austria" class="team-icon">',
    'Belgium': '<img src="https://upload.wikimedia.org/wikipedia/commons/thumb/6/65/Flag_of_Belgium.svg/1182px-Flag_of_Belgium.svg.png" alt="Belgium" class="team-icon">',
    'Slovakia': '<img src="https://upload.wikimedia.org/wikipedia/commons/thumb/e/e6/Flag_of_Slovakia.svg/1280px-Flag_of_Slovakia.svg.png" alt="Slovakia" class="team-icon">',
    'Romania': '<img src="https://upload.wikimedia.org/wikipedia/commons/thumb/7/73/Flag_of_Romania.svg/2560px-Flag_of_Romania.svg.png" alt="Romania" class="team-icon">',
    'Italy': '<img src="https://upload.wikimedia.org/wikipedia/commons/thumb/0/03/Flag_of_Italy.svg/1280px-Flag_of_Italy.svg.png" alt="Italy" class="team-icon">',
    'Ukraine': '<img src="https://upload.wikimedia.org/wikipedia/commons/d/d2/Flag_of_Ukraine.png" alt="Ukraine" class="team-icon">',
    'Georgia': '<img src="https://upload.wikimedia.org/wikipedia/commons/thumb/0/0f/Flag_of_Georgia.svg/1024px-Flag_of_Georgia.svg.png" alt="Georgia" class="team-icon">',
    'Denmark': '<img src="https://upload.wikimedia.org/wikipedia/commons/thumb/9/9c/Flag_of_Denmark.svg/512px-Flag_of_Denmark.svg.png" alt="Denmark" class="team-icon">',
    'Slovenia': '<img src="https://upload.wikimedia.org/wikipedia/commons/thumb/f/f0/Flag_of_Slovenia.svg/1280px-Flag_of_Slovenia.svg.png" alt="Slovenia" class="team-icon">',
    'Hungary': '<img src="https://upload.wikimedia.org/wikipedia/commons/thumb/c/c1/Flag_of_Hungary.svg/1280px-Flag_of_Hungary.svg.png" alt="Hungary" class="team-icon">',
    'Serbia': '<img src="https://upload.wikimedia.org/wikipedia/commons/thumb/f/ff/Flag_of_Serbia.svg/1200px-Flag_of_Serbia.svg.png" alt="Serbia" class="team-icon">',
    'Croatia': '<img src="https://upload.wikimedia.org/wikipedia/commons/thumb/1/1b/Flag_of_Croatia.svg/2560px-Flag_of_Croatia.svg.png" alt="Croatia" class="team-icon">',
    'Czechia': '<img src="https://upload.wikimedia.org/wikipedia/commons/thumb/c/cb/Flag_of_the_Czech_Republic.svg/2560px-Flag_of_the_Czech_Republic.svg.png" alt="Czechia" class="team-icon">',
    'Albania': '<img src="https://upload.wikimedia.org/wikipedia/commons/thumb/3/36/Flag_of_Albania.svg/2560px-Flag_of_Albania.svg.png" alt="Albania" class="team-icon">',
    'Poland': '<img src="https://upload.wikimedia.org/wikipedia/commons/thumb/1/12/Flag_of_Poland.svg/2560px-Flag_of_Poland.svg.png" alt="Poland" class="team-icon">',
    'Scotland': '<img src="https://upload.wikimedia.org/wikipedia/commons/thumb/1/10/Flag_of_Scotland.svg/2560px-Flag_of_Scotland.svg.png" alt="Scotland" class="team-icon">',
    'Brazil': '<img src="https://upload.wikimedia.org/wikipedia/commons/thumb/0/05/Flag_of_Brazil.svg/2560px-Flag_of_Brazil.svg.png" alt="Brazil" class="team-icon">',
    'Japan': '<img src="https://upload.wikimedia.org/wikipedia/commons/thumb/9/9e/Flag_of_Japan.svg/2560px-Flag_of_Japan.svg.png" alt="Japan" class="team-icon">',
    'South Korea': '<img src="https://upload.wikimedia.org/wikipedia/commons/thumb/0/09/Flag_of_South_Korea.svg/2560px-Flag_of_South_Korea.svg.png" alt="South Korea" class="team-icon">',
    'USA': '<img src="https://upload.wikimedia.org/wikipedia/commons/thumb/d/de/Flag_of_the_United_States.png/1024px-Flag_of_the_United_States.png" alt="USA" class="team-icon">',
    'Argentina': '<img src="https://upload.wikimedia.org/wikipedia/commons/thumb/1/1a/Flag_of_Argentina.svg/2560px-Flag_of_Argentina.svg.png" alt="Argentina" class="team-icon">',
    'Canada': '<img src="https://upload.wikimedia.org/wikipedia/commons/b/b6/Flag_of_Canada.png" alt="Canada" class="team-icon">',
    'Mexico': '<img src="https://upload.wikimedia.org/wikipedia/commons/thumb/f/fc/Flag_of_Mexico.svg/2560px-Flag_of_Mexico.svg.png" alt="Mexico" class="team-icon">',
    'Cameroon': '<img src="https://upload.wikimedia.org/wikipedia/commons/thumb/4/4f/Flag_of_Cameroon.svg/2560px-Flag_of_Cameroon.svg.png" alt="Cameroon" class="team-icon">',
    'Senegal': '<img src="https://upload.wikimedia.org/wikipedia/commons/f/fd/Flag_of_Senegal.svg" alt="Senegal" class="team-icon">',
    'Ghana': '<img src="https://upload.wikimedia.org/wikipedia/commons/thumb/1/19/Flag_of_Ghana.svg/2560px-Flag_of_Ghana.svg.png" alt="Ghana" class="team-icon">',
    'Tunisia': '<img src="https://upload.wikimedia.org/wikipedia/commons/thumb/c/ce/Flag_of_Tunisia.svg/2560px-Flag_of_Tunisia.svg.png" alt="Tunisia" class="team-icon">',
    'Qatar': '<img src="https://upload.wikimedia.org/wikipedia/commons/thumb/6/65/Flag_of_Qatar.svg/2560px-Flag_of_Qatar.svg.png" alt="Qatar" class="team-icon">',
    'Australia': '<img src="https://upload.wikimedia.org/wikipedia/commons/thumb/b/b9/Flag_of_Australia.svg/2560px-Flag_of_Australia.svg.png" alt="Australia" class="team-icon">',
    'Saudi Arabia': '<img src="https://upload.wikimedia.org/wikipedia/commons/thumb/0/0a/Flag_of_Saudi_Arabia_%28type_2%29.svg/2560px-Flag_of_Saudi_Arabia_%28type_2%29.svg.png" alt="Saudi Arabia" class="team-icon">',
    'Morocco': '<img src="https://upload.wikimedia.org/wikipedia/commons/thumb/2/2c/Flag_of_Morocco.svg/1280px-Flag_of_Morocco.svg.png" alt="Morocco" class="team-icon">',
    'Iran': '<img src="https://upload.wikimedia.org/wikipedia/commons/thumb/c/ca/Flag_of_Iran.svg/2560px-Flag_of_Iran.svg.png" alt="Iran" class="team-icon">',
    'Costa Rica': '<img src="https://upload.wikimedia.org/wikipedia/commons/thumb/b/bc/Flag_of_Costa_Rica_%28state%29.svg/2560px-Flag_of_Costa_Rica_%28state%29.svg.png" alt="Costa Rica" class="team-icon">',
    'Wales': '<img src="https://upload.wikimedia.org/wikipedia/commons/thumb/d/dc/Flag_of_Wales.svg/1280px-Flag_of_Wales.svg.png" alt="Wales" class="team-icon">',
    'Uruguay': '<img src="https://upload.wikimedia.org/wikipedia/commons/thumb/f/fe/Flag_of_Uruguay.svg/2560px-Flag_of_Uruguay.svg.png" alt="Uruguay" class="team-icon">',
    'Ecuador': '<img src="https://upload.wikimedia.org/wikipedia/commons/thumb/e/e8/Flag_of_Ecuador.svg/2560px-Flag_of_Ecuador.svg.png" alt="Ecuador" class="team-icon">'
};

function getTeamLogo(name, competitionCode) {
    const isNational = ['EC', 'WC'].includes(competitionCode);
    const cleanedName = name.trim();

    if (isNational) {
        return countryFlags[cleanedName] || '⚽️';
    } else {
        return clubLogos[cleanedName] || '⚽️';
    }
}

function showMatchDetails(home, away, comp) {
    alert(`${comp}\n${home} vs ${away}\n\nUpdates every minute.`);
}

function updateDateTime() {
    const now = new Date();
    document.getElementById('currentDate').textContent = now.toLocaleDateString('en-GB', {
        weekday: 'long', year: 'numeric', month: 'short', day: 'numeric'
    });
    document.getElementById('currentTime').textContent = now.toLocaleTimeString('en-GB', {
        hour: '2-digit', minute: '2-digit'
    });
}

function updateLastUpdatedTime() {
    const now = new Date();
    const formatted = now.toLocaleTimeString('en-GB', {
        hour: '2-digit',
        minute: '2-digit',
        second: '2-digit'
    });
    const element = document.getElementById('lastUpdated');
    if (element) element.textContent = `Last updated: ${formatted}`;
}

function setupUI() {
    updateDateTime();
    updateLastUpdatedTime();

    const refreshBtn = document.getElementById('manualRefreshBtn');
    if (refreshBtn) {
        refreshBtn.addEventListener('click', () => {
            loadTodaysMatches();
            updateDateTime();
            updateLastUpdatedTime();
        });
    }

    // Update time display every 30 seconds
    setInterval(updateDateTime, 30 * 1000);
}

function startAutoRefresh() {
    // Auto-refresh match data every 60 seconds
    autoRefreshInterval = setInterval(() => {
        loadTodaysMatches();
        updateDateTime();
        updateLastUpdatedTime();
    }, 60 * 1000);
}

// Initialize app when DOM is loaded
document.addEventListener('DOMContentLoaded', initializeApp);

// Cleanup on window close
window.addEventListener('beforeunload', () => {
    if (autoRefreshInterval) clearInterval(autoRefreshInterval);
});