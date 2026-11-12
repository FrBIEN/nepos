import java.beans.XMLDecoder;
import java.io.*;
import java.util.*;
import filius.gui.netzwerksicht.*;
import filius.hardware.*;
import filius.hardware.knoten.*;
import filius.software.email.*;
import filius.software.system.Betriebssystem;

/** Decode only our generated XML; never run this against untrusted imported JavaBeans XML. */
class VerifyFls {
  public static void main(String[] args) throws Exception {
    try { for(String path:args) {
      List<Exception> errors=new ArrayList<>();
      try(XMLDecoder decoder=new XMLDecoder(new BufferedInputStream(new FileInputStream(path)),null,errors::add)) {
        decoder.readObject();
        List<?> nodes=(List<?>)decoder.readObject(),cables=(List<?>)decoder.readObject(),docs=(List<?>)decoder.readObject();
        if(!errors.isEmpty())throw new IllegalStateException(path+": "+errors,errors.get(0));
        for(Object item:nodes){GUIKnotenItem node=(GUIKnotenItem)item;if(node.getKnoten()==null||node.getImageLabel()==null)throw new IllegalStateException("Incomplete node");if(node.getKnoten() instanceof Host){for(Object app:((Betriebssystem)node.getKnoten().getSystemSoftware()).getInstallierteAnwendungen().values()){if(app instanceof EmailAnwendung mail){for(Email message:mail.getEmpfangeneNachrichten())for(AddressEntry recipient:message.getEmpfaenger())if(recipient.getMailAddress()==null)throw new IllegalStateException("Mail recipient lost");}if(app instanceof EmailServer server){for(EmailKonto account:server.getListeBenutzerkonten())for(Email message:account.getNachrichten())for(AddressEntry recipient:message.getEmpfaenger())if(recipient.getMailAddress()==null)throw new IllegalStateException("Mailbox recipient lost");}}}}
        for(Object item:cables){GUIKabelItem cable=(GUIKabelItem)item;for(Port port:cable.getDasKabel().getAnschluesse())if(port==null||port.isPortFrei())throw new IllegalStateException("Cable not connected");}
        System.out.println("PASS: Java Filius decoded "+new File(path).getName()+" ("+nodes.size()+" nodes, "+cables.size()+" cables, "+docs.size()+" annotations)");
      }
    }
    System.exit(0); } catch(Throwable error){error.printStackTrace();System.exit(1);}
  }
}
