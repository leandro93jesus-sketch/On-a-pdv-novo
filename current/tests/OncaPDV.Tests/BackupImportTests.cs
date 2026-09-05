using Microsoft.Data.Sqlite;
using OncaPDV.Infrastructure;

namespace OncaPDV.Tests;

public sealed class BackupImportTests
{
 [Fact]public async Task External_backup_is_validated_imported_and_can_restore_data(){using var env=new BackupEnv();var ops=new OperationalService(env.Db,env.Paths);await env.SetMarker("ANTES");var generated=await ops.CreateBackupAsync();var external=Path.Combine(env.External,"backup-transferido.zip");File.Copy(generated,external);await env.SetMarker("DEPOIS");var imported=await ops.ImportBackupAsync(external);Assert.StartsWith(Path.GetFullPath(env.Paths.Backups),Path.GetFullPath(imported));await ops.RestoreAsync(imported);Assert.Equal("ANTES",await env.Marker());Assert.Equal("ok",env.Db.IntegrityCheck());}
 [Fact]public async Task Corrupt_external_backup_is_rejected_without_touching_database(){using var env=new BackupEnv();var ops=new OperationalService(env.Db,env.Paths);await env.SetMarker("PRESERVAR");var corrupt=Path.Combine(env.External,"corrompido.zip");await File.WriteAllBytesAsync(corrupt,[1,2,3,4]);var before=Directory.GetFiles(env.Paths.Backups,"*.zip").Length;await Assert.ThrowsAnyAsync<Exception>(()=>ops.ImportBackupAsync(corrupt));Assert.Equal(before,Directory.GetFiles(env.Paths.Backups,"*.zip").Length);Assert.Equal("PRESERVAR",await env.Marker());Assert.Equal("ok",env.Db.IntegrityCheck());}
 private sealed class BackupEnv:IDisposable
 {
  public string Root{get;}=Path.Combine(Path.GetTempPath(),"onca-import-"+Guid.NewGuid());public string External{get;}public AppPaths Paths{get;}public OncaDatabase Db{get;}
  public BackupEnv(){External=Path.Combine(Root,"external");Paths=new(Root,Path.Combine(Root,"data"),Path.Combine(Root,"backups"),Path.Combine(Root,"logs"),Path.Combine(Root,"exports"),Path.Combine(Root,"print"));Directory.CreateDirectory(External);Db=new(Paths);Db.Migrate();}
  public async Task SetMarker(string value){await using var c=Db.Open();await using var q=c.CreateCommand();q.CommandText="INSERT INTO suppliers(id,name,active) VALUES('marker',$v,1) ON CONFLICT(id) DO UPDATE SET name=$v";q.Parameters.AddWithValue("$v",value);await q.ExecuteNonQueryAsync();}
  public async Task<string?> Marker(){await using var c=Db.Open();await using var q=c.CreateCommand();q.CommandText="SELECT name FROM suppliers WHERE id='marker'";return Convert.ToString(await q.ExecuteScalarAsync());}
  public void Dispose(){SqliteConnection.ClearAllPools();if(Directory.Exists(Root))Directory.Delete(Root,true);}
 }
}
