import { Events } from 'bf6-portal-utils/events/index.ts';

const ZEROVECTOR = mod.CreateVector(0, 0, 0);
const team1 = mod.GetTeam(1);
const team2 = mod.GetTeam(2);

let bombPosTeam1: mod.Vector = ZEROVECTOR
let bombPosTeam2: mod.Vector = ZEROVECTOR;
let bombTeam1: mod.Bomb;
let bombTeam2: mod.Bomb;

Events.OnGameModeStarted.subscribe(async () => {
    for (let i = 0; i < 5; i++) {
        mod.DisplayHighlightedWorldLogMessage(mod.Message(mod.stringkeys.ctf.init1));
        await mod.Wait(1);
    }
    mod.DisplayHighlightedWorldLogMessage(mod.Message(mod.stringkeys.ctf.title));

    let mcomPosTeam1 = mod.GetObjectPosition(mod.GetSpatialObject(101));
    let mcomPosTeam2 = mod.GetObjectPosition(mod.GetSpatialObject(102));
    let mcomTeam1 = mod.SpawnObject(mod.RuntimeSpawn_Common.MCOM, mcomPosTeam1, ZEROVECTOR);
    let mcomTeam2 = mod.SpawnObject(mod.RuntimeSpawn_Common.MCOM, mcomPosTeam2, ZEROVECTOR);
    mod.SetMCOMOwner(mcomTeam1, team1);
    mod.SetMCOMOwner(mcomTeam2, team2);
    await mod.Wait(1);
    mod.SetMCOMArmType(mcomTeam1, mod.MCOMArmType.Bomb);
    mod.SetMCOMArmType(mcomTeam2, mod.MCOMArmType.Bomb);
    await mod.Wait(1);
    mod.EnableGameModeObjective(mcomTeam1, true);
    mod.EnableGameModeObjective(mcomTeam2, true);

    bombPosTeam1 = mod.Add(mcomPosTeam1, mod.ForwardVector());
    bombPosTeam2 = mod.Add(mcomPosTeam2, mod.ForwardVector());
    bombTeam1 = mod.SpawnObject(mod.RuntimeSpawn_Common.Bomb, bombPosTeam1, ZEROVECTOR);
    bombTeam2 = mod.SpawnObject(mod.RuntimeSpawn_Common.Bomb, bombPosTeam2, ZEROVECTOR);
    // only team 2 is able to pick up the bomb at team 1's MCOM
    mod.SetBombTeam(bombTeam1, team2);
    // only team 1 is able to pick up the bomb at team 2's MCOM
    mod.SetBombTeam(bombTeam2, team1);
    mod.SetBombWorldIconGlobalVisibility(bombTeam1, true);
    mod.SetBombWorldIconGlobalVisibility(bombTeam2, true);

    let moveDown = mod.CreateVector(0, -3, 0);
    mod.MoveObject(mcomTeam1, moveDown);
    mod.MoveObject(mcomTeam2, moveDown);

    mod.SetGameModeCriteria(mod.ScoreCriteria.HighestProgress);
    mod.SetGameModeInitialScore(team1, 0);
    mod.SetGameModeInitialScore(team2, 0);
    mod.SetGameModeTargetScore(3);
    mod.SetGameModeScore(team1, 0);
    mod.SetGameModeScore(team2, 0);
    mod.SetHUDTicker(mod.GameModeTicker.Ticker_TeamDM);

    mod.SetScoreboardType(mod.ScoreboardType.CustomTwoTeams);
    mod.SetScoreboardHeader(mod.Message(mod.stringkeys.ctf.title));
    mod.SetScoreboardColumnNames(
        mod.Message(mod.stringkeys.ctf.scoreboard.col1),
        mod.Message(mod.stringkeys.ctf.scoreboard.col2),
        mod.Message(mod.stringkeys.ctf.scoreboard.col3),
        mod.Message(mod.stringkeys.ctf.scoreboard.col4)
    );
    mod.SetScoreboardColumnWidths(1, 1, 1, 1);
    mod.SetScoreboardSorting(4, false);
});

Events.OngoingPlayer.subscribe(async (player) => {
    mod.SetScoreboardPlayerValues(
        player, mod.GetPlayerKills(player), mod.GetPlayerDeaths(player), 0, 0
    );
    if (!mod.GetSoldierState(player, mod.SoldierStateBool.HasBomb)) return;

    let scoringTeam = mod.GetTeam(player);
    let scoringTeamId = mod.GetObjId(scoringTeam);
    let targetLocation = scoringTeamId === mod.GetObjId(team1) ? bombPosTeam1 : bombPosTeam2;
    let enemyBomb = scoringTeamId === mod.GetObjId(team1) ? bombTeam2 : bombTeam1;

    if (
        mod.DistanceBetween(mod.GetObjectPosition(player), targetLocation) < 3
    ) {
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