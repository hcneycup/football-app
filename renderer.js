const { ipcRenderer } = require('electron');
let matchesData = [];
let autoRefreshInterval;
let isLoading = false;

const leagues = {
    PL: 2021,     // Premier League
    BL1: 2002,    // Bundesliga  
    CL: 2001, // Champions League
    PD: 2014 // LA LIGA
};

let activeLeagues = new Set(Object.keys(leagues));

function resetDailyState() {
    cachedMatches = [];
    cachedDate = '';
    lastFetchTime = 0;
    activeLeagues = new Set(Object.keys(leagues));
    console.log("🔁 Daily state reset: all leagues reactivated");
}

function londonYMD(d) {
    return new Intl.DateTimeFormat('en-CA', {
        timeZone: 'Europe/London',
        year: 'numeric', month: '2-digit', day: '2-digit'
    }).format(d);
}

function todayLondonISO() {
    return londonYMD(new Date());
}

function tomorrowLondonISO() {
    const now = new Date();
    const t = new Date(now.getTime() + 36 * 60 * 60 * 1000);
    return londonYMD(t);
}

const STATUS_MAP = {
    IN_PLAY: 'LIVE',
    PAUSED: 'HT',
    FINISHED: 'FT',
    POSTPONED: 'PST',
    CANCELED: 'CANC',
    SUSPENDED: 'SUSP'
};

function mapFDStatusToShort(status) {
    return STATUS_MAP[status] || 'NS';
}

let API_KEY;

async function initializeApp() {
    try {
        API_KEY = String((await ipcRenderer.invoke('get-api-key')) ?? '').trim();
        if (!API_KEY) {
            console.error('Football-Data API key missing/empty from IPC.');
            showNoMatchesMessage();
            return;
        }

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
let cachedDate = '';
const CACHE_DURATION = 120000;

function hasLiveMatches(matches) {
    return matches.some(m => {
        const s = m.fixture?.status?.short;
        return s === 'LIVE' || s === 'HT';
    });
}

let lastKnownScores = {};
let lastKnownStatus = {};

async function loadTodaysMatches() {
    if (isLoading) {
        console.log('⏳ Already loading, skipping...');
        return;
    }
    isLoading = true;

    try {
        const today = todayLondonISO();
        const tomorrow = tomorrowLondonISO();
        console.log('🗓️ Query window (Europe/London):', today, '→', tomorrow);

        const now = Date.now();
        const shouldUseCache = cachedMatches.length > 0 &&
            cachedDate === today &&
            (now - lastFetchTime) < CACHE_DURATION;

        if (shouldUseCache) {
            console.log('Using cached data');
            hideNoMatchesMessage();
            displayMatches(cachedMatches);
            updateLastUpdatedTime();
            return;
        }

        let totalMatches = 0;
        let allMatches = [];
        let hasRateLimit = false;

        for (const [leagueName, leagueCode] of Object.entries(leagues)) {
            try {
                const url = `https://api.football-data.org/v4/matches?competitions=${leagueCode}&dateFrom=${today}&dateTo=${tomorrow}`;
                console.log('🌐 Fetching (FD):', leagueName, url);

                const res = await fetch(url, {
                    headers: { 'X-Auth-Token': API_KEY, 'accept': 'application/json' }
                });

                console.log('📡 Response status:', res.status, 'for', leagueName);

                if (res.status === 429) {
                    console.log('Rate limit reached for league:', leagueName);
                    hasRateLimit = true;
                    continue;
                }

                if (!res.ok) {
                    const errorText = await res.text();
                    console.error('API Error:', res.status, errorText);
                    continue;
                }

                const data = await res.json();
                const raw = Array.isArray(data.matches) ? data.matches : [];

                const fdMatches = raw.filter(m => londonYMD(new Date(m.utcDate)) === today);

                const normalized = fdMatches.map(m => {
                    const matchId = m.id || `${m.homeTeam?.id || m.homeTeam?.name}-${m.awayTeam?.id || m.awayTeam?.name}`;

                    let homeScore = m.score?.fullTime?.home;
                    let awayScore = m.score?.fullTime?.away;
                    let currentStatus = mapFDStatusToShort(m.status);

                    if (homeScore == null || awayScore == null) {
                        if (lastKnownScores[matchId]) {
                            ({ homeScore, awayScore } = lastKnownScores[matchId]);
                        } else {
                            homeScore = awayScore = '-';
                        }
                    } else {
                        lastKnownScores[matchId] = { homeScore, awayScore };
                    }

                    if (!currentStatus || currentStatus === 'NS') {
                        if (lastKnownStatus[matchId]) {
                            currentStatus = lastKnownStatus[matchId];
                        }
                    } else {
                        lastKnownStatus[matchId] = currentStatus;
                    }

                    return {
                        league: { name: m.competition?.name || leagueName },
                        teams: {
                            home: { name: m.homeTeam?.name || 'Unknown', logo: m.homeTeam?.crest || '' },
                            away: { name: m.awayTeam?.name || 'Unknown', logo: m.awayTeam?.crest || '' },
                        },
                        goals: { home: homeScore, away: awayScore },
                        fixture: {
                            date: m.utcDate,
                            status: { short: currentStatus }
                        }
                    };
                });

                console.log(`📊 ${leagueName} raw: ${raw.length}, after filter: ${normalized.length}`);

                if (normalized.length > 0) {
                    allMatches = allMatches.concat(normalized);
                    totalMatches += normalized.length;
                } else {
                    console.log(`❌ No matches found for ${leagueName}`);
                }

            } catch (err) {
                console.error('Error loading matches for', leagueName, ':', err);
            }
        }

        console.log('🏆 Total matches found:', totalMatches);

        if (totalMatches > 0) {
            hideNoMatchesMessage();
            cachedMatches = allMatches;
            cachedDate = today;
            lastFetchTime = now;
            displayMatches(allMatches);
            console.log('Displaying fresh data');
        }
        else if (hasRateLimit && cachedMatches.length > 0 && cachedDate === today) {
            console.log('Rate limited - displaying cached matches');
            hideNoMatchesMessage();
            displayMatches(cachedMatches);
        }
        else if (cachedMatches.length > 0 && cachedDate === today) {
            hideNoMatchesMessage();
            displayMatches(cachedMatches);
        }
        else {
            console.log('🚫 No matches found - showing no matches message');
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

    const STATUS_CLASS = {
        LIVE: 'live',
        HT: 'paused',
        FT: 'finished',
        PST: 'cancelled',
        CANC: 'cancelled',
        SUSP: 'paused',
        NS: 'scheduled'
    };

    let html = '';

    matches.forEach(match => {
        const home = match.teams?.home?.name || 'Unknown';
        const away = match.teams?.away?.name || 'Unknown';
        const homeScore = match.goals?.home ?? '-';
        const awayScore = match.goals?.away ?? '-';
        const comp = match.league?.name || 'Unknown Competition';

        const kickoff = new Date(match.fixture?.date).toLocaleTimeString('en-GB', {
            hour: '2-digit',
            minute: '2-digit',
            timeZone: 'Europe/London'
        });

        const status = (match.fixture?.status?.short || 'NS');
        const statusClass = STATUS_CLASS[status] || 'scheduled';
        const statusText = status === 'NS' ? kickoff : status;

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
        details += `Status: ${status} | Kick-off: ${kickoff}\n`;
    }

    alert(details);
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
    let lastLondonDate = todayLondonISO();
    let kickoffTimeout;
    let currentIntervalMs = 0;

    function adjustInterval(ms) {
        if (currentIntervalMs === ms && autoRefreshInterval) return;
        if (autoRefreshInterval) clearInterval(autoRefreshInterval);
        autoRefreshInterval = setInterval(tick, ms);
        currentIntervalMs = ms;
        console.log(`⏱️ Auto-refresh set to every ${ms / 1000} seconds`);
    }

    function scheduleKickoffRefresh(matches) {
        if (kickoffTimeout) clearTimeout(kickoffTimeout);

        const now = new Date();
        let earliestKickoff = null;

        for (const m of matches) {
            if ((m.fixture?.status?.short || 'NS') !== 'NS') continue;
            const kickoff = new Date(m.fixture.date);
            const diffMins = (kickoff - now) / 60000;
            if (diffMins > 0 && diffMins <= 3) {
                if (!earliestKickoff || kickoff < earliestKickoff) earliestKickoff = kickoff;
            }
        }

        if (earliestKickoff) {
            const msUntilKickoff = earliestKickoff - now;
            if (msUntilKickoff > 0) {
                console.log(`📅 Scheduling instant refresh at kickoff: ${earliestKickoff}`);
                kickoffTimeout = setTimeout(() => {
                    const secondsSinceLastFetch = (Date.now() - lastFetchTime) / 1000;
                    if (secondsSinceLastFetch > 30) {
                        console.log("🚀 Kickoff reached — refreshing now");
                        tick();
                    } else {
                        console.log("⏭️ Skipping kickoff refresh — last fetch was recent");
                    }
                }, msUntilKickoff);
            }
        }
    }

    async function tick() {
        const currentLondonDate = todayLondonISO();

        if (currentLondonDate !== lastLondonDate) {
            console.log("📅 Date changed (London):", lastLondonDate, "→", currentLondonDate);
            if (typeof resetDailyState === 'function') {
                resetDailyState();
            } else {
                cachedMatches = [];
                cachedDate = '';
                lastFetchTime = 0;
                if (typeof activeLeagues !== 'undefined') {
                    activeLeagues = new Set(Object.keys(leagues));
                }
            }
            lastLondonDate = currentLondonDate;
            if (kickoffTimeout) clearTimeout(kickoffTimeout);
        }

        await loadTodaysMatches();

        if (!cachedMatches || cachedMatches.length === 0) {
            console.log("🚫 No matches scheduled today — stopping auto-refresh.");
            if (autoRefreshInterval) clearInterval(autoRefreshInterval);
            if (kickoffTimeout) clearTimeout(kickoffTimeout);
            return;
        }

        const now = new Date();
        const hasUpcomingSoon = cachedMatches.some(m => {
            if ((m.fixture?.status?.short || 'NS') !== 'NS') return false;
            const kickoff = new Date(m.fixture.date);
            const diffMins = (kickoff - now) / 60000;
            return diffMins >= 0 && diffMins <= 3;
        });

        const hasLive = hasLiveMatches(cachedMatches);

        adjustInterval((hasLive || hasUpcomingSoon) ? 60 * 1000 : 5 * 60 * 1000);
        scheduleKickoffRefresh(cachedMatches);

        updateDateTime();
        updateLastUpdatedTime();
    }

    tick();
}

if (document.readyState === 'loading') {
    document.addEventListener('DOMContentLoaded', initializeApp);
} else {
    initializeApp();
}

window.addEventListener('beforeunload', () => {
    if (autoRefreshInterval) clearInterval(autoRefreshInterval);
});
