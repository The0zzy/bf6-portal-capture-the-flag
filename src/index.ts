import { Events } from 'bf6-portal-utils/events/index.ts';

const ZEROVECTOR = mod.CreateVector(0, 0, 0);
const bombDropFuseTime = 15;
const targetScore = 3;
const team1 = mod.GetTeam(1);
const team2 = mod.GetTeam(2);

let bombTeam1: mod.Bomb;
let bombTeam2: mod.Bomb;
let mcomTeam1: mod.MCOM;
let mcomTeam2: mod.MCOM;
let capturePointTeam1: mod.CapturePoint;
let capturePointTeam2: mod.CapturePoint;
let captureAreaTeam1: mod.AreaTrigger;
let captureAreaTeam2: mod.AreaTrigger;

export interface PlayerData {
    kills: number;
    deaths: number;
    assists: number;
    intelDeliveries: number;
    score: number;
}

export const playerData = new Map<number, PlayerData>();

function createPlayerData(): PlayerData {
    return {
        kills: 0,
        deaths: 0,
        assists: 0,
        intelDeliveries: 0,
        score: 0,
    };
}

function getPlayerData(player: mod.Player | number): PlayerData {
    const playerId = typeof player === 'number' ? player : mod.GetObjId(player);
    let data = playerData.get(playerId);
    if (!data) {
        data = createPlayerData();
        playerData.set(playerId, data);
    }
    return data;
}

function sendIntelNotification(scoringTeam: mod.Team, message: mod.Message): void {
    const enemyTeam = mod.Equals(scoringTeam, team1) ? team2 : team1;
    const friendly = mod.CreateGameEventNotificationData();
    mod.SetIconForGameEventNotificationData(friendly, mod.WorldIconImages.Flag);
    mod.SetSizeForGameEventNotificationData(friendly, mod.GameEventNotificationSizes.Large);
    mod.SetColorForGameEventNotificationData(friendly, mod.GameEventNotificationColors.Friendly);
    mod.SetStyleForGameEventNotificationData(friendly, mod.GameEventNotificationStyles.Normal);
    mod.SetMessageForGameEventNotificationData(friendly, message);
    mod.SendGameEventNotification(friendly, scoringTeam);

    const enemy = mod.CreateGameEventNotificationData();
    mod.SetIconForGameEventNotificationData(enemy, mod.WorldIconImages.Flag);
    mod.SetSizeForGameEventNotificationData(enemy, mod.GameEventNotificationSizes.Large);
    mod.SetColorForGameEventNotificationData(enemy, mod.GameEventNotificationColors.Enemy);
    mod.SetStyleForGameEventNotificationData(enemy, mod.GameEventNotificationStyles.Normal);
    mod.SetMessageForGameEventNotificationData(enemy, message);
    mod.SendGameEventNotification(enemy, enemyTeam);
}

Events.OnGameModeStarted.subscribe(async () => {
    for (let i = 0; i < 5; i++) {
        mod.DisplayHighlightedWorldLogMessage(mod.Message(mod.stringkeys.ctf.init1));
        await mod.Wait(1);
    }
    mod.DisplayHighlightedWorldLogMessage(mod.Message(mod.stringkeys.ctf.title));

    bombTeam1 = mod.GetBomb(101);
    bombTeam2 = mod.GetBomb(102);
    // only team 2 is able to pick up the bomb at team 1's MCOM
    mod.SetBombTeam(bombTeam1, team2);
    // only team 1 is able to pick up the bomb at team 2's MCOM
    mod.SetBombTeam(bombTeam2, team1);
    for (const bomb of [bombTeam1, bombTeam2]) {
        mod.SetBombWorldIconGlobalVisibility(bomb, true);
        mod.SetBombDropFuseTime(bomb, bombDropFuseTime);
    }

    mcomTeam1 = mod.GetMCOM(201);
    mcomTeam2 = mod.GetMCOM(202);
    for (const mcom of [mcomTeam1, mcomTeam2]) {
        mod.EnableGameModeObjective(mcom, false);
        // it seems that MCOMs having their armtype set to bomb are no longer able to be enabled/disabled afterwards
        mod.SetMCOMArmType(mcom, mod.MCOMArmType.Bomb);
    }

    captureAreaTeam1 = mod.GetAreaTrigger(301);
    captureAreaTeam2 = mod.GetAreaTrigger(302);

    capturePointTeam1 = mod.GetCapturePoint(401);
    capturePointTeam2 = mod.GetCapturePoint(402);
    for (const cp of [capturePointTeam1, capturePointTeam2]) {
        mod.EnableGameModeObjective(cp, true);
        mod.EnableCapturePointDeploying(cp, false);
        mod.SetCapturePointNeutralizationTime(cp, 9999);
        mod.SetCapturePointCapturingTime(cp, 9999);
        mod.SetMaxCaptureMultiplier(cp, 0.0001);
    }

    mod.SetGameModeInitialScore(team1, 0);
    mod.SetGameModeInitialScore(team2, 0);
    mod.SetGameModeTargetScore(targetScore);
    mod.SetGameModeScore(team1, 0);
    mod.SetGameModeScore(team2, 0);
    mod.SetHUDTicker(mod.GameModeTicker.Ticker_TeamDM);

    mod.SetScoreboardType(mod.ScoreboardType.CustomTwoTeams);
    mod.SetScoreboardHeader(
        mod.Message(mod.stringkeys.ctf.title)
    );
    mod.SetScoreboardHeader(
        mod.Message(mod.stringkeys.ctf.scoreboard.team1),
        mod.Message(mod.stringkeys.ctf.scoreboard.team2)
    );
    mod.SetScoreboardColumnNames(
        mod.Message(mod.stringkeys.ctf.scoreboard.col1),
        mod.Message(mod.stringkeys.ctf.scoreboard.col2),
        mod.Message(mod.stringkeys.ctf.scoreboard.col3),
        mod.Message(mod.stringkeys.ctf.scoreboard.col4),
        mod.Message(mod.stringkeys.ctf.scoreboard.col5)
    );
    mod.SetScoreboardColumnWidths(20, 20, 20, 20, 20);
    mod.SetScoreboardSorting(4, false);
});

Events.OnPlayerJoinGame.subscribe(async (player: mod.Player) => {
    playerData.set(mod.GetObjId(player), createPlayerData());
    updateScoreboard(player);
});

Events.OnPlayerLeaveGame.subscribe(async (playerId: number) => {
    playerData.delete(playerId);
});

Events.OnPlayerEnterAreaTrigger.subscribe(async (player, areaTrigger) => {
    if (!mod.GetSoldierState(player, mod.SoldierStateBool.HasBomb)) return;

    let scoringTeam = mod.GetTeam(player);
    let scoringTeamId = mod.GetObjId(scoringTeam);
    if (
        (
            mod.Equals(areaTrigger, captureAreaTeam1) &&
            scoringTeamId === mod.GetObjId(team1)
        ) ||
        (
            mod.Equals(areaTrigger, captureAreaTeam2) &&
            scoringTeamId === mod.GetObjId(team2)
        )
    ) {
        let enemyBomb = scoringTeamId === mod.GetObjId(team1) ? bombTeam2 : bombTeam1;
        mod.ForceBombDrop(enemyBomb);
        mod.ForceBombReset(enemyBomb);
        mod.SetGameModeScore(scoringTeam, mod.GetGameModeScore(scoringTeam) + 1);

        const data = getPlayerData(player);
        data.intelDeliveries += 1;
        data.score += 1;
        updateScoreboard(player);

        sendIntelNotification(
            scoringTeam,
            mod.Message(
                mod.stringkeys.ctf.scored,
                mod.GetObjId(scoringTeam),
                player
            )
        );
    }
});

Events.OnBombPickedUp.subscribe(async (bomb, player) => {
    mod.SetBombWorldIconGlobalVisibility(bomb, true);
    let scoringTeam = mod.GetTeam(player);
    let mcomToActivate = mod.Equals(bomb, bombTeam1) ? mcomTeam2 : mcomTeam1;
    mod.SetMCOMArmType(mcomToActivate, mod.MCOMArmType.Default);
    mod.EnableGameModeObjective(mcomToActivate, true);
    mod.SetMCOMArmType(mcomToActivate, mod.MCOMArmType.Bomb);

    const data = getPlayerData(player);
    data.score += 50;
    updateScoreboard(player);

    sendIntelNotification(
        scoringTeam,
        mod.Message(
            mod.stringkeys.ctf.picked_up,
            mod.GetObjId(scoringTeam),
            player
        )
    );
});

Events.OnBombStateChanged.subscribe(async (bomb, state) => {
    let bombStateStringKey = "";
    switch (true) {
        case mod.Equals(state, mod.BombState.Carried):
            bombStateStringKey = mod.stringkeys.ctf.bomb_states.carried;
            break;
        case mod.Equals(state, mod.BombState.Defusing):
            bombStateStringKey = mod.stringkeys.ctf.bomb_states.defusing;
            break;
        case mod.Equals(state, mod.BombState.Dropped):
            bombStateStringKey = mod.stringkeys.ctf.bomb_states.dropped;
            break;
        case mod.Equals(state, mod.BombState.Inactive):
            bombStateStringKey = mod.stringkeys.ctf.bomb_states.inactive;
            break;
        case mod.Equals(state, mod.BombState.ObjectiveCompleted):
            bombStateStringKey = mod.stringkeys.ctf.bomb_states.objective_completed;
            break;
        case mod.Equals(state, mod.BombState.Planted):
            bombStateStringKey = mod.stringkeys.ctf.bomb_states.planted;
            break;
        case mod.Equals(state, mod.BombState.Planting):
            bombStateStringKey = mod.stringkeys.ctf.bomb_states.planting;
            break;
        case mod.Equals(state, mod.BombState.Resetting):
            bombStateStringKey = mod.stringkeys.ctf.bomb_states.resetting;
            break;
        case mod.Equals(state, mod.BombState.Spawned):
            bombStateStringKey = mod.stringkeys.ctf.bomb_states.spawned;
            break;
        case mod.Equals(state, mod.BombState.Unspawned):
            bombStateStringKey = mod.stringkeys.ctf.bomb_states.unspawned;
            break;
        default:
            bombStateStringKey = mod.stringkeys.ctf.bomb_states.state_changed;
            break;
    }
    mod.DisplayHighlightedWorldLogMessage(
        mod.Message(
            bombStateStringKey,
            mod.GetObjId(bomb),
            Number(state)
        )
    );
    mod.SendErrorReport(
        mod.Message(
            bombStateStringKey,
            mod.GetObjId(bomb),
            Number(state)
        )
    );
    if (mod.Equals(state, mod.BombState.Resetting)) {
        let mcomToDisable = mod.Equals(bomb, bombTeam1) ? mcomTeam2 : mcomTeam1;
        mod.SetMCOMArmType(mcomToDisable, mod.MCOMArmType.Default);
        mod.EnableGameModeObjective(mcomToDisable, false);
        mod.SetMCOMArmType(mcomToDisable, mod.MCOMArmType.Bomb);
        mod.ForceBombSpawn(bomb);
    }
});

Events.OnPlayerEarnedKill.subscribe(async (player, victim) => {
    const data = getPlayerData(player);
    data.kills += 1;
    data.score += 1;
    updateScoreboard(player);
});
Events.OnPlayerEarnedKillAssist.subscribe(async (player, victim) => {
    const data = getPlayerData(player);
    data.assists += 1;
    data.score += 1;
    updateScoreboard(player);
});
Events.OnPlayerDied.subscribe(async (player, killer) => {
    const data = getPlayerData(player);
    data.deaths += 1;
    updateScoreboard(player);
});

function updateScoreboard(player: mod.Player) {
    if (!mod.IsPlayerValid(player)) return;
    const data = getPlayerData(player);
    mod.SetScoreboardPlayerValues(
        player,
        data.kills,
        data.deaths,
        data.assists,
        data.intelDeliveries,
        data.score
    );
}

