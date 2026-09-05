using System.Security.Cryptography.X509Certificates;
using System.Security.Cryptography.Xml;
using System.Text;
using System.Text.Json;
using System.Xml;
using System.Xml.Linq;
using OncaPDV.Domain;

namespace OncaPDV.Fiscal;

public static class FiscalModels { public const string NFe="55"; public const string NFCe="65"; public static bool IsValid(string value)=>value is NFe or NFCe; }
public sealed record FiscalRequest(Sale Sale,string Model,string Environment);
public sealed record FiscalResult(FiscalStatus Status,string? AccessKey=null,string? Protocol=null,string? AuthorizedXml=null,string? Error=null,string? RejectionCode=null,bool IsMock=false,string? RawResponse=null);
public interface IFiscalProvider
{
 Task<FiscalResult> IssueAsync(FiscalRequest request,CancellationToken ct=default);
 Task<FiscalResult> QueryAsync(string key,string environment,CancellationToken ct=default)=>Task.FromResult(new FiscalResult(FiscalStatus.Rejected,AccessKey:key,Error:"Consulta não suportada."));
 Task<FiscalResult> CancelAsync(string key,string protocol,string justification,string environment,CancellationToken ct=default)=>Task.FromResult(new FiscalResult(FiscalStatus.Rejected,AccessKey:key,Protocol:protocol,Error:"Cancelamento não suportado."));
}
public sealed class MockFiscalProvider:IFiscalProvider
{
 public Task<FiscalResult> IssueAsync(FiscalRequest request,CancellationToken ct=default){if(!Hom(request.Environment))return Task.FromResult(Blocked());if(!FiscalModels.IsValid(request.Model))return Task.FromResult(new FiscalResult(FiscalStatus.Rejected,Error:"Modelo fiscal inválido."));var key=$"MOCK-{request.Model}-{request.Sale.Number:000000000000}";return Task.FromResult(new FiscalResult(FiscalStatus.Authorized,key,$"MOCK-{Guid.NewGuid():N}",$"<mockFiscal modelo=\"{request.Model}\" ambiente=\"HOMOLOGACAO\" semValorFiscal=\"true\" />",IsMock:true));}
 public Task<FiscalResult> QueryAsync(string key,string environment,CancellationToken ct=default)=>Task.FromResult(Hom(environment)?new(FiscalStatus.Authorized,key,"MOCK-CONSULTA",IsMock:true):Blocked());
 public Task<FiscalResult> CancelAsync(string key,string protocol,string justification,string environment,CancellationToken ct=default)=>Task.FromResult(!Hom(environment)?Blocked():justification.Trim().Length<15?new(FiscalStatus.Rejected,key,protocol,Error:"Justificativa deve ter ao menos 15 caracteres.",IsMock:true):new(FiscalStatus.Cancelled,key,$"MOCK-CANCEL-{Guid.NewGuid():N}",IsMock:true));
 private static bool Hom(string value)=>string.Equals(value,"Homologacao",StringComparison.OrdinalIgnoreCase);private static FiscalResult Blocked()=>new(FiscalStatus.Rejected,Error:"Produção bloqueada.");
}

public sealed record FiscalAddress(string Street,string Number,string District,string City,string IbgeCode,string State,string PostalCode);
public sealed record FiscalConfiguration(string Cnpj,string StateRegistration,int TaxRegime,FiscalAddress Address,string CscSecretReference,string CscId,string CertificateSecretReference,string CertificatePasswordSecretReference,int Series,long NextNumber,string Environment,int NfeSeries=1,long NfeNextNumber=1)
{
 public bool IsHomologation=>string.Equals(Environment,"Homologacao",StringComparison.OrdinalIgnoreCase);
 public (int Series,long Number) NumberFor(string model)=>model==FiscalModels.NFe?(NfeSeries,NfeNextNumber):(Series,NextNumber);
 public void Validate(string model=FiscalModels.NFCe){if(!IsHomologation)throw new InvalidOperationException("Somente homologação está permitida.");if(!FiscalModels.IsValid(model))throw new InvalidOperationException("Modelo fiscal deve ser 55 ou 65.");if(Digits(Cnpj).Length!=14||string.IsNullOrWhiteSpace(StateRegistration)||Address.IbgeCode.Length!=7||Address.State.Length!=2||Digits(Address.PostalCode).Length!=8)throw new InvalidOperationException("Configuração fiscal da empresa incompleta ou inválida.");if(string.IsNullOrWhiteSpace(CertificateSecretReference)||string.IsNullOrWhiteSpace(CertificatePasswordSecretReference))throw new InvalidOperationException("Certificado A1 e senha devem usar referências seguras.");if(model==FiscalModels.NFCe&&(string.IsNullOrWhiteSpace(CscId)||string.IsNullOrWhiteSpace(CscSecretReference)))throw new InvalidOperationException("CSC e identificador do CSC são obrigatórios para NFC-e.");if(new[]{CscSecretReference,CertificateSecretReference,CertificatePasswordSecretReference}.Any(x=>x.Contains("senha",StringComparison.OrdinalIgnoreCase)))throw new InvalidOperationException("Credenciais devem usar referência segura, nunca texto puro.");var n=NumberFor(model);if(n.Series<=0||n.Number<=0)throw new InvalidOperationException("Série e numeração fiscal devem ser positivas.");}
 internal static string Digits(string value)=>new(value.Where(char.IsDigit).ToArray());
}
public interface IFiscalSecretStore{Task<byte[]> ReadAsync(string secretReference,CancellationToken ct=default);}
public interface IFiscalSigner{Task<string> SignAsync(string unsignedXml,byte[] certificate,ReadOnlyMemory<char> password,CancellationToken ct=default);}
public sealed class A1FiscalSigner:IFiscalSigner
{
 public Task<string> SignAsync(string unsignedXml,byte[] certificate,ReadOnlyMemory<char> password,CancellationToken ct=default){ct.ThrowIfCancellationRequested();using var cert=X509CertificateLoader.LoadPkcs12(certificate,new string(password.Span),X509KeyStorageFlags.EphemeralKeySet|X509KeyStorageFlags.Exportable);using var key=cert.GetRSAPrivateKey()??throw new InvalidOperationException("Certificado A1 sem chave privada RSA.");var doc=new XmlDocument{PreserveWhitespace=true};doc.LoadXml(unsignedXml);var target=doc.SelectSingleNode("//*[local-name()='infNFe']") as XmlElement??throw new InvalidOperationException("infNFe ausente.");var id=target.GetAttribute("Id");if(string.IsNullOrWhiteSpace(id))throw new InvalidOperationException("Id da infNFe ausente.");var signature=new SignedXml(doc){SigningKey=key};var reference=new Reference("#"+id);reference.AddTransform(new XmlDsigEnvelopedSignatureTransform());reference.AddTransform(new XmlDsigC14NTransform());signature.AddReference(reference);signature.KeyInfo=new KeyInfo();signature.KeyInfo.AddClause(new KeyInfoX509Data(cert));signature.ComputeSignature();doc.DocumentElement!.AppendChild(doc.ImportNode(signature.GetXml(),true));return Task.FromResult(doc.OuterXml);}
}
public interface IHomologationTransport
{
 Task<FiscalResult> SendAsync(string signedXml,CancellationToken ct=default);
 Task<FiscalResult> QueryAsync(string key,CancellationToken ct=default)=>Task.FromResult(new FiscalResult(FiscalStatus.Rejected,AccessKey:key,Error:"Consulta SEFAZ não configurada."));
 Task<FiscalResult> CancelAsync(string key,string protocol,string justification,CancellationToken ct=default)=>Task.FromResult(new FiscalResult(FiscalStatus.Rejected,AccessKey:key,Protocol:protocol,Error:"Cancelamento SEFAZ não configurado."));
}
public interface IFiscalDocumentStore{Task SaveAsync(Guid saleId,FiscalResult result,string? xml,CancellationToken ct=default);}
public sealed class DisabledHomologationTransport:IHomologationTransport{public Task<FiscalResult> SendAsync(string signedXml,CancellationToken ct=default)=>throw new InvalidOperationException("SEFAZ BLOQUEADA: transporte de homologação não configurado.");}
public sealed class HomologacaoFiscalProvider(FiscalConfiguration configuration,IFiscalSecretStore secrets,IFiscalSigner signer,IHomologationTransport transport):IFiscalProvider
{
 public async Task<FiscalResult> IssueAsync(FiscalRequest request,CancellationToken ct=default){if(!Allowed(request.Environment))return new(FiscalStatus.Rejected,Error:"Produção bloqueada.");try{configuration.Validate(request.Model);var unsigned=FiscalXmlBuilder.Build(request.Sale,configuration,request.Model);FiscalXmlValidator.Validate(unsigned,request.Model,false);var cert=await secrets.ReadAsync(configuration.CertificateSecretReference,ct);var pass=await secrets.ReadAsync(configuration.CertificatePasswordSecretReference,ct);try{var signed=await signer.SignAsync(unsigned,cert,Encoding.UTF8.GetString(pass).AsMemory(),ct);FiscalXmlValidator.Validate(signed,request.Model,true);return await transport.SendAsync(signed,ct);}finally{Array.Clear(pass);Array.Clear(cert);}}catch(OperationCanceledException){return new(FiscalStatus.Contingency,Error:"Timeout/cancelamento na homologação.");}catch(Exception ex){return new(FiscalStatus.Rejected,Error:ex.Message);}}
 public Task<FiscalResult> QueryAsync(string key,string environment,CancellationToken ct=default)=>Allowed(environment)?transport.QueryAsync(key,ct):Task.FromResult(new FiscalResult(FiscalStatus.Rejected,AccessKey:key,Error:"Produção bloqueada."));
 public Task<FiscalResult> CancelAsync(string key,string protocol,string justification,string environment,CancellationToken ct=default)=>!Allowed(environment)?Task.FromResult(new FiscalResult(FiscalStatus.Rejected,AccessKey:key,Error:"Produção bloqueada.")):justification.Trim().Length<15?Task.FromResult(new FiscalResult(FiscalStatus.Rejected,AccessKey:key,Error:"Justificativa deve ter ao menos 15 caracteres.")):transport.CancelAsync(key,protocol,justification,ct);
 private bool Allowed(string env)=>configuration.IsHomologation&&string.Equals(env,"Homologacao",StringComparison.OrdinalIgnoreCase);
}
public sealed class FiscalService(IFiscalProvider provider,IFiscalDocumentStore store)
{
 public Task<FiscalResult> IssueAsync(Sale sale,CancellationToken ct=default)=>IssueAsync(sale,FiscalModels.NFCe,ct);
 public async Task<FiscalResult> IssueAsync(Sale sale,string model,CancellationToken ct=default){if(!FiscalModels.IsValid(model))return new(FiscalStatus.Rejected,Error:"Modelo fiscal inválido.");await store.SaveAsync(sale.Id,new(FiscalStatus.Processing),null,ct);var result=await provider.IssueAsync(new(sale,model,"Homologacao"),ct);await store.SaveAsync(sale.Id,result,result.Status==FiscalStatus.Authorized?result.AuthorizedXml:null,ct);return result;}
 public Task<FiscalResult> QueryAsync(string key,CancellationToken ct=default)=>provider.QueryAsync(key,"Homologacao",ct);public Task<FiscalResult> CancelAsync(string key,string protocol,string reason,CancellationToken ct=default)=>provider.CancelAsync(key,protocol,reason,"Homologacao",ct);
}
public static class FiscalXmlBuilder
{
 private static readonly XNamespace Ns="http://www.portalfiscal.inf.br/nfe";
 public static string Build(Sale sale,FiscalConfiguration config,string model=FiscalModels.NFCe){config.Validate(model);if(sale.Items.Count==0)throw new InvalidOperationException("Venda sem itens.");var (series,number)=config.NumberFor(model);var key=AccessKey(config,sale,model,series,number);var items=sale.Items.Select((x,i)=>new XElement(Ns+"det",new XAttribute("nItem",i+1),new XElement(Ns+"prod",new XElement(Ns+"cProd",x.Code),new XElement(Ns+"xProd",x.Name),new XElement(Ns+"qCom",Num(x.Quantity)),new XElement(Ns+"vUnCom",Money(x.UnitPrice)))));var pays=sale.Payments.Select(x=>new XElement(Ns+"detPag",new XElement(Ns+"tPag",Map(x.Method)),new XElement(Ns+"vPag",Money(x.Amount))));var doc=new XDocument(new XElement(Ns+"NFe",new XElement(Ns+"infNFe",new XAttribute("Id","NFe"+key),new XAttribute("versao","4.00"),new XElement(Ns+"ide",new XElement(Ns+"cUF",Uf(config.Address.State)),new XElement(Ns+"natOp","VENDA"),new XElement(Ns+"mod",model),new XElement(Ns+"serie",series),new XElement(Ns+"nNF",number),new XElement(Ns+"dhEmi",sale.CreatedAt.ToString("yyyy-MM-ddTHH:mm:sszzz")),new XElement(Ns+"tpAmb","2"),new XElement(Ns+"finNFe","1"),new XElement(Ns+"indFinal","1"),new XElement(Ns+"indPres",model==FiscalModels.NFCe?"1":"0")),new XElement(Ns+"emit",new XElement(Ns+"CNPJ",FiscalConfiguration.Digits(config.Cnpj)),new XElement(Ns+"IE",config.StateRegistration),new XElement(Ns+"CRT",config.TaxRegime)),items,new XElement(Ns+"total",new XElement(Ns+"vDesc",Money(sale.Discount)),new XElement(Ns+"vNF",Money(sale.Total))),new XElement(Ns+"pag",pays))));return doc.ToString(SaveOptions.DisableFormatting);}
 private static string AccessKey(FiscalConfiguration c,Sale s,string m,int serie,long number){var body=Uf(c.Address.State)+s.CreatedAt.ToString("yyMM")+FiscalConfiguration.Digits(c.Cnpj)+m+serie.ToString("000")+number.ToString("000000000")+"1"+Math.Abs(s.Id.GetHashCode()).ToString("00000000")[..8];return body+Digit(body);}
 private static int Digit(string v){var w=2;var sum=0;for(var i=v.Length-1;i>=0;i--){sum+=(v[i]-'0')*w;if(++w>9)w=2;}var d=11-sum%11;return d>=10?0:d;}
 private static string Uf(string uf)=>uf.ToUpperInvariant() switch{"RO"=>"11","AC"=>"12","AM"=>"13","RR"=>"14","PA"=>"15","AP"=>"16","TO"=>"17","MA"=>"21","PI"=>"22","CE"=>"23","RN"=>"24","PB"=>"25","PE"=>"26","AL"=>"27","SE"=>"28","BA"=>"29","MG"=>"31","ES"=>"32","RJ"=>"33","SP"=>"35","PR"=>"41","SC"=>"42","RS"=>"43","MS"=>"50","MT"=>"51","GO"=>"52","DF"=>"53",_=>throw new InvalidOperationException("UF fiscal inválida.")};
 private static string Money(decimal v)=>v.ToString("0.00",System.Globalization.CultureInfo.InvariantCulture);private static string Num(decimal v)=>v.ToString("0.###",System.Globalization.CultureInfo.InvariantCulture);private static string Map(PaymentMethod m)=>m switch{PaymentMethod.Cash=>"01",PaymentMethod.Credit=>"03",PaymentMethod.Debit=>"04",PaymentMethod.Pix=>"17",_=>"99"};
}
public static class FiscalXmlValidator
{
 public static void Validate(string xml,string model,bool requireSignature){var doc=XDocument.Parse(xml,LoadOptions.PreserveWhitespace);XNamespace ns="http://www.portalfiscal.inf.br/nfe";var inf=doc.Descendants(ns+"infNFe").SingleOrDefault()??throw new InvalidOperationException("XML fiscal sem infNFe.");if((string?)inf.Descendants(ns+"mod").SingleOrDefault()!=model)throw new InvalidOperationException("Modelo divergente no XML.");if((string?)inf.Descendants(ns+"tpAmb").SingleOrDefault()!="2")throw new InvalidOperationException("XML fora de homologação.");if(!((string?)inf.Attribute("Id"))?.StartsWith("NFe",StringComparison.Ordinal)==true)throw new InvalidOperationException("Chave fiscal ausente.");if(!inf.Descendants(ns+"det").Any())throw new InvalidOperationException("XML fiscal sem itens.");if(requireSignature&&!doc.Descendants().Any(x=>x.Name.LocalName=="Signature"))throw new InvalidOperationException("Assinatura digital ausente.");}
}
public sealed class FileFiscalDocumentStore(string root):IFiscalDocumentStore
{
 public async Task SaveAsync(Guid saleId,FiscalResult result,string? xml,CancellationToken ct=default){Directory.CreateDirectory(root);var dir=Path.Combine(root,saleId.ToString("N"));Directory.CreateDirectory(dir);var stamp=DateTimeOffset.UtcNow.ToString("yyyyMMddHHmmssfff");await Atomic(Path.Combine(dir,$"{stamp}-{result.Status}.json"),Encoding.UTF8.GetBytes(JsonSerializer.Serialize(result,new JsonSerializerOptions{WriteIndented=true})),ct);if(result.Status==FiscalStatus.Authorized&&!string.IsNullOrWhiteSpace(xml))await Atomic(Path.Combine(dir,$"{stamp}-autorizado.xml"),Encoding.UTF8.GetBytes(xml),ct);}
 private static async Task Atomic(string path,byte[] data,CancellationToken ct){var tmp=path+"."+Guid.NewGuid().ToString("N")+".tmp";await File.WriteAllBytesAsync(tmp,data,ct);File.Move(tmp,path);}
}
public static class DanfeHomologationRenderer
{
 public static string Render(FiscalResult doc,string model){if(doc.Status!=FiscalStatus.Authorized||string.IsNullOrWhiteSpace(doc.AccessKey)||string.IsNullOrWhiteSpace(doc.Protocol)||string.IsNullOrWhiteSpace(doc.AuthorizedXml))throw new InvalidOperationException("DANFE bloqueado: documento fiscal não autorizado.");return $"HOMOLOGACAO - SEM VALOR FISCAL\n{(model==FiscalModels.NFCe?"DANFE NFC-e":"DANFE NF-e")}\nChave: {doc.AccessKey}\nProtocolo: {doc.Protocol}\n{(doc.IsMock?"SIMULACAO MOCK - NAO E DOCUMENTO FISCAL":"DOCUMENTO AUTORIZADO EM HOMOLOGACAO")}";}
}
