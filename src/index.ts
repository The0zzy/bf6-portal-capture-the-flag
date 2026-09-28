import { Events } from 'bf6-portal-utils/events/index.ts';

const ZEROVECTOR = mod.CreateVector(0, 0, 0);
Events.OnGameModeStarted.subscribe(async () => {
    for (let i = 0; i < 5; i++) {
        mod.DisplayHighlightedWorldLogMessage(mod.Message(mod.stringkeys.ctf.init1));
        await mod.Wait(1);
    }
    mod.DisplayHighlightedWorldLogMessage(mod.Message(mod.stringkeys.ctf.title));

    const team1 = mod.GetTeam(1);
    const team2 = mod.GetTeam(2);
    let mcomPosTeam1 = mod.GetObjectPosition(mod.GetSpatialObject(101));
    let mcomPosTeam2 = mod.GetObjectPosition(mod.GetSpatialObject(102));
    let mcomTeam1 = mod.SpawnObject(mod.RuntimeSpawn_Common.MCOM, mcomPosTeam1, ZEROVECTOR);
    let mcomTeam2 = mod.SpawnObject(mod.RuntimeSpawn_Common.MCOM, mcomPosTeam2, ZEROVECTOR);
    mod.SetMCOMOwner(mcomTeam1, team1);
    mod.SetMCOMOwner(mcomTeam2, team2);
    mod.SetMCOMArmType(mcomTeam1, mod.MCOMArmType.Bomb);
    mod.SetMCOMArmType(mcomTeam2, mod.MCOMArmType.Bomb);
    mod.EnableGameModeObjective(mcomTeam1, true);
    mod.EnableGameModeObjective(mcomTeam2, true);

    let bombPosTeam1 = mod.Add(mcomPosTeam1, mod.ForwardVector());
    let bombPosTeam2 = mod.Add(mcomPosTeam2, mod.ForwardVector());
    let bombTeam1 = mod.SpawnObject(mod.RuntimeSpawn_Common.Bomb, bombPosTeam1, ZEROVECTOR);
    let bombTeam2 = mod.SpawnObject(mod.RuntimeSpawn_Common.Bomb, bombPosTeam2, ZEROVECTOR);
    // only team 2 is able to pick up the bomb at team 1's MCOM
    mod.SetBombTeam(bombTeam1, team2);
    // only team 1 is able to pick up the bomb at team 2's MCOM
    mod.SetBombTeam(bombTeam2, team1);

    mod.SetGameModeCriteria(mod.ScoreCriteria.HighestProgress);
    mod.SetScoreboardType(mod.ScoreboardType.CustomTwoTeams);
    mod.SetGameModeInitialScore(team1, 0);
    mod.SetGameModeInitialScore(team2, 0);
    mod.SetGameModeTargetScore(3);
    mod.SetGameModeScore(team1, 0);
    mod.SetGameModeScore(team2, 0);
    mod.SetHUDTicker(mod.GameModeTicker.Ticker_TeamDM);
});
