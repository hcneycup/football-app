const { ipcRenderer } = require('electron');
let matchesData = [];
let autoRefreshInterval;
let isLoading = false;

const leagues = {
    'PL': 39,     // Premier League
    'BL1': 78,    // Bundesliga  
    'PD': 140,    // La Liga
    'CL': 2,      // Champions League
    'Serie A': 71, // Serie A
};

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

let lastFetchTime = 0;
let cachedMatches = [];
const CACHE_DURATION = 120000;

function hasLiveMatches(matches) {
    return matches.some(match =>
        match.fixture?.status?.short === '1H' ||
        match.fixture?.status?.short === '2H' ||
        match.fixture?.status?.short === 'HT' ||
        match.fixture?.status?.short === 'ET' ||
        match.fixture?.status?.short === 'PEN'
    );
}

async function loadTodaysMatches() {
    if (isLoading) {
        console.log('⏳ Already loading, skipping...');
        return;
    }
    isLoading = true;

    try {
        const today = new Date().toISOString().split('T')[0];
        const now = Date.now();

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

        let totalMatches = 0;
        let allMatches = [];
        let hasRateLimit = false;

        for (const [leagueName, leagueId] of Object.entries(leagues)) {
            try {
                const url = `https://v3.football.api-sports.io/fixtures?league=${leagueId}&date=${today}`;
                const res = await fetch(url, {
                    headers: {
                        'X-RapidAPI-Key': API_KEY,
                        'X-RapidAPI-Host': 'v3.football.api-sports.io'
                    }
                });

                if (res.status === 429) {
                    console.log('Rate limit reached for league:', leagueName);
                    hasRateLimit = true;
                    continue;
                }

                if (!res.ok) {
                    const errorText = await res.text();
                    console.error('API Error:', res.status, errorText);
                    throw new Error(`Error: ${res.status}`);
                }

                const data = await res.json();
                const todayMatches = data.response || [];

                if (todayMatches && todayMatches.length > 0) {
                    allMatches = allMatches.concat(todayMatches);
                    totalMatches += todayMatches.length;
                }

            } catch (err) {
                console.error('Error loading matches:', err);
            }
        }

        if (totalMatches > 0) {
            hideNoMatchesMessage();
            cachedMatches = allMatches;
            lastFetchTime = now;
            displayMatches(allMatches);
            console.log('Displaying fresh data');
        }
        else if (hasRateLimit && cachedMatches.length > 0) {
            console.log('Rate limited - displaying cached matches');
            hideNoMatchesMessage();
            displayMatches(cachedMatches);
        }
        else if (cachedMatches.length > 0) {
            hideNoMatchesMessage();
            displayMatches(cachedMatches);
        }
        else {
            showNoMatchesMessage();
        }

        updateLastUpdatedTime();

    } finally {
        isLoading = false;
    }
}

function showNoMatchesMessage() {
    const wrapper = document.getElementById('noMatchesWrapper');
    const message = document.getElementById('noMatchesMessage');

    if (wrapper) {
        wrapper.style.display = 'flex';
        requestAnimationFrame(() => {
            wrapper.classList.add('show');
        });
    }
    if (message) {
        message.style.display = 'block';
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

function displayMatches(matches) {
    const container = document.querySelector('.matches-container');
    const popupWrapper = document.getElementById('noMatchesWrapper');
    const popup = document.getElementById('noMatchesMessage');
    const loading = document.getElementById('loadingMessage');

    if (popupWrapper) popupWrapper.style.display = 'none';
    if (popup) popup.style.display = 'none';
    if (loading) loading.style.display = 'none';

    container.innerHTML = '';

    let html = '';

    matches.forEach(match => {
        const home = match.teams?.home?.name || 'Unknown';
        const away = match.teams?.away?.name || 'Unknown';
        const homeScore = match.goals?.home ?? '-';
        const awayScore = match.goals?.away ?? '-';
        const comp = match.league?.name || 'Unknown Competition';

        const kickoff = new Date(match.fixture?.date).toLocaleTimeString('en-GB', {
            hour: '2-digit',
            minute: '2-digit'
        });

        let statusText;
        let statusClass;

        const status = match.fixture?.status?.short;
        switch (status) {
            case '1H':
            case '2H':
                statusText = 'LIVE';
                statusClass = 'live';
                break;
            case 'HT':
                statusText = 'HT';
                statusClass = 'paused';
                break;
            case 'FT':
            case 'AET':
            case 'PEN':
                statusText = 'FT';
                statusClass = 'finished';
                break;
            case 'PST':
            case 'CANC':
            case 'ABD':
                statusText = 'CANC';
                statusClass = 'cancelled';
                break;
            case 'NS':
            case 'TBD':
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
                            ${getTeamLogo(match.teams.home)}
                            <span class="team-name">${home}</span>
                        </div>
                    </div>
                    <div class="match-score">
                        ${homeScore} – ${awayScore}
                    </div>
                    <div class="team">
                        <div class="team-info">
                            ${getTeamLogo(match.teams.away)}
                            <span class="team-name">${away}</span>
                        </div>
                    </div>
                </div>
                ${getMatchCards(match)}
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

function getTeamLogo(teamData) {
    if (teamData?.logo) {
        return `<img src="${teamData.logo}" alt="${teamData.name}" class="team-icon">`;
    }

    const cleanedName = teamData?.name?.trim() || '';
    return clubLogos[cleanedName] || '⚽️';
}

function getMatchCards(match) {
    const status = match.fixture?.status?.short;
    if (status !== '1H' && status !== '2H' && status !== 'HT' && status !== 'FT' && status !== 'AET') {
        return '';
    }

    if (!match.events || match.events.length === 0) {
        return '';
    }

    const homeCards = [];
    const awayCards = [];

    match.events.forEach(event => {
        if (event.type === 'Card') {
            const isHome = event.team?.name === match.teams?.home?.name;
            const fullName = event.player?.name || 'Unknown';
            const lastName = fullName.split(' ').pop();
            const minute = event.time?.elapsed || '?';

            const cardIcon = event.detail === 'Yellow Card' ?
                '<div class="pixel-card yellow-pixel-card"></div>' :
                '<div class="pixel-card red-pixel-card"></div>';

            const cardInfo = `${cardIcon} ${lastName} ${minute}'`;

            if (isHome) {
                homeCards.push(cardInfo);
            } else {
                awayCards.push(cardInfo);
            }
        }
    });

    if (homeCards.length === 0 && awayCards.length === 0) {
        return '';
    }

    return `
        <div class="match-cards">
            <div class="team-cards home-cards">
                ${homeCards.map(card => `<div class="card-item">${card}</div>`).join('')}
            </div>
            <div class="vs-divider"></div>
            <div class="team-cards away-cards">
                ${awayCards.map(card => `<div class="card-item">${card}</div>`).join('')}
            </div>
        </div>
    `;
}

function showMatchDetails(home, away, comp) {
    const matchData = cachedMatches.find(match =>
        match.teams.home.name === home && match.teams.away.name === away
    );

    let details = `${comp}\n${home} vs ${away}\n\n`;

    if (matchData) {
        const kickoff = new Date(matchData.fixture?.date).toLocaleTimeString('en-GB', {
            hour: '2-digit',
            minute: '2-digit'
        });
        const status = matchData.fixture?.status?.short;
        const homeScore = matchData.goals?.home ?? '-';
        const awayScore = matchData.goals?.away ?? '-';

        details += `Score: ${homeScore} - ${awayScore}\n`;
        details += `Status: ${status} | Kick-off: ${kickoff}\n\n`;

        if (matchData.events && matchData.events.length > 0) {
            details += "MATCH EVENTS:\n";
            details += "─────────────\n";

            matchData.events.forEach(event => {
                const minute = event.time?.elapsed || '?';
                const eventIcon = getEventIcon(event.type, event.detail);
                const playerName = event.player?.name || 'Unknown';
                const teamName = event.team?.name === home ? home : away;

                details += `${minute}' ${eventIcon} ${playerName} (${teamName})\n`;
            });
        } else {
            details += "No events yet\n";
        }
    }

    details += `\nUpdates every minute.`;
    alert(details);
}

function getEventIcon(type, detail) {
    if (type === "Goal") return "⚽";
    if (type === "Card" && detail === "Yellow Card") return '<div class="pixel-card yellow-pixel-card"></div>';
    if (type === "Card" && detail === "Red Card") return '<div class="pixel-card red-pixel-card"></div>';
    if (type === "subst") return "🔄";
    return "📝";
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

    setInterval(updateDateTime, 30 * 1000);
}

function startAutoRefresh() {
    autoRefreshInterval = setInterval(() => {
        loadTodaysMatches();
        updateDateTime();
        updateLastUpdatedTime();
    }, 60 * 1000);
}

document.addEventListener('DOMContentLoaded', initializeApp);

window.addEventListener('beforeunload', () => {
    if (autoRefreshInterval) clearInterval(autoRefreshInterval);
});