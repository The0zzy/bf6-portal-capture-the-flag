import { Events } from 'bf6-portal-utils/events/index.ts';

const ZEROVECTOR = mod.CreateVector(0, 0, 0);
const bombDropFuseTime = 15;
const targetScore = 3;
const team1 = mod.GetTeam(1);
const team2 = mod.GetTeam(2);

let bombPosTeam1: mod.Vector = ZEROVECTOR
let bombPosTeam2: mod.Vector = ZEROVECTOR;
let bombTeam1: mod.Bomb;
let bombTeam2: mod.Bomb;
let mcomTeam1: mod.MCOM;
let mcomTeam2: mod.MCOM;
let capturePointTeam1: mod.CapturePoint;
let capturePointTeam2: mod.CapturePoint;
let captureAreaTeam1: mod.AreaTrigger;
let captureAreaTeam2: mod.AreaTrigger;

Events.OnGameModeStarted.subscribe(async () => {
    for (let i = 0; i < 5; i++) {
        mod.DisplayHighlightedWorldLogMessage(mod.Message(mod.stringkeys.ctf.init1));
        await mod.Wait(1);
    }
    mod.DisplayHighlightedWorldLogMessage(mod.Message(mod.stringkeys.ctf.title));

    bombPosTeam1 = mod.GetObjectPosition(mod.GetSpatialObject(101));
    bombPosTeam2 = mod.GetObjectPosition(mod.GetSpatialObject(102));
    bombTeam1 = mod.SpawnObject(mod.RuntimeSpawn_Common.Bomb, bombPosTeam1, ZEROVECTOR);
    bombTeam2 = mod.SpawnObject(mod.RuntimeSpawn_Common.Bomb, bombPosTeam2, ZEROVECTOR);
    // only team 2 is able to pick up the bomb at team 1's MCOM
    mod.SetBombTeam(bombTeam1, team2);
    // only team 1 is able to pick up the bomb at team 2's MCOM
    mod.SetBombTeam(bombTeam2, team1);
    mod.SetBombWorldIconGlobalVisibility(bombTeam1, false);
    mod.SetBombWorldIconGlobalVisibility(bombTeam2, false);
    mod.SetBombDropFuseTime(bombTeam1, bombDropFuseTime);
    mod.SetBombDropFuseTime(bombTeam2, bombDropFuseTime);

    mcomTeam1 = mod.GetMCOM(201);
    mcomTeam2 = mod.GetMCOM(202);
    mod.EnableGameModeObjective(mcomTeam1, false);
    mod.EnableGameModeObjective(mcomTeam2, false);

    captureAreaTeam1 = mod.GetAreaTrigger(301);
    captureAreaTeam2 = mod.GetAreaTrigger(302);

    capturePointTeam1 = mod.GetCapturePoint(401);
    capturePointTeam2 = mod.GetCapturePoint(402);
    mod.EnableGameModeObjective(capturePointTeam1, true);
    mod.EnableGameModeObjective(capturePointTeam2, true);
    mod.EnableCapturePointDeploying(capturePointTeam1, false);
    mod.EnableCapturePointDeploying(capturePointTeam2, false);
    mod.SetCapturePointNeutralizationTime(capturePointTeam1, 9999);
    mod.SetCapturePointNeutralizationTime(capturePointTeam2, 9999);
    mod.SetCapturePointCapturingTime(capturePointTeam1, 9999);
    mod.SetCapturePointCapturingTime(capturePointTeam2, 9999);

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
        mod.Message(mod.stringkeys.ctf.scoreboard.col4)
    );
    mod.SetScoreboardColumnWidths(25, 25, 25, 25);
    mod.SetScoreboardSorting(3, false);
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
        mod.DisplayHighlightedWorldLogMessage(
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
    mod.EnableGameModeObjective(mcomToActivate, true);
    mod.DisplayHighlightedWorldLogMessage(
        mod.Message(
            mod.stringkeys.ctf.picked_up,
            mod.GetObjId(scoringTeam),
            player
        )
    );
});

Events.OnPlayerEarnedKill.subscribe(async (player, victim) => {
    updateScoreboard(player);
});
Events.OnPlayerEarnedKillAssist.subscribe(async (player, victim) => {
    updateScoreboard(player);
});
Events.OnPlayerDied.subscribe(async (player, killer) => {
    updateScoreboard(player);
});

function updateScoreboard(player: mod.Player) {
    mod.SetScoreboardPlayerValues(
        player, mod.GetPlayerKills(player), mod.GetPlayerDeaths(player), 0, 0
    );
}

