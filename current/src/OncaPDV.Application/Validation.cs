namespace OncaPDV.Application;
public static class BrazilianTaxId
{
 public static bool IsValid(string? value){if(string.IsNullOrWhiteSpace(value))return true;var d=new string(value.Where(char.IsDigit).ToArray());return d.Length switch{11=>Cpf(d),14=>Cnpj(d),_=>false};}
 private static bool Cpf(string d){if(d.Distinct().Count()==1)return false;var s=0;for(var i=0;i<9;i++)s+=(d[i]-48)*(10-i);var a=s%11<2?0:11-s%11;s=0;for(var i=0;i<10;i++)s+=(d[i]-48)*(11-i);var b=s%11<2?0:11-s%11;return a==d[9]-48&&b==d[10]-48;}
 private static bool Cnpj(string d){if(d.Distinct().Count()==1)return false;int Digit(int length,int[] weights){var s=0;for(var i=0;i<length;i++)s+=(d[i]-48)*weights[i];var r=s%11;return r<2?0:11-r;}var a=Digit(12,[5,4,3,2,9,8,7,6,5,4,3,2]);var b=Digit(13,[6,5,4,3,2,9,8,7,6,5,4,3,2]);return a==d[12]-48&&b==d[13]-48;}
}
