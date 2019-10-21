using System.Collections;
using System.Collections.Generic;
using UnityEngine;
using UnityEngine.Events;



public class LegSelectionArea : MonoBehaviour
{
    
    public GameObject leg;
    private Inspector inspector;

    private RaycastHit hit;
    private Ray ray;

    // Start is called before the first frame update
    void Start()
    {
        inspector = leg.GetComponent<Leg>().inspector;


    }
    
    
    public void SetSpeed(string speed)
    {
        var legScript = leg.GetComponent<Leg>();
        legScript.flightSpeed = (double)System.Convert.ToInt32(speed);
        // Camera.main.Render();
        Debug.Log("Changed speed to - " + speed);
        
    }
    
    public void SetInboundAltitude(string altitude)
    {
        var legScript = leg.GetComponent<Leg>();
        legScript.inboundAltitude = System.Convert.ToInt32(altitude);
        Debug.Log("Changed inbound altitude to - " + altitude);
    }
    
    public void SetOutboundAltitude(string altitude)
    {
        var legScript = leg.GetComponent<Leg>();
        legScript.outboundAltitude = System.Convert.ToInt32(altitude);
        Debug.Log("Changed outbound altitude to - " + altitude);
    }

    // Update is called once per frame
    void Update()
    {
        
        if(Input.GetMouseButtonDown(0))
        {
            if (inspector.selected == this.gameObject) return;
            
            ray = Camera.main.ScreenPointToRay(Input.mousePosition);
            if(Physics.Raycast (ray, out hit))
            {
                if(hit.transform == this.transform)
                {
                    EditMode();
                }
            }
        }
    }

    void EditMode()
    {
        List<Param> paramaters = new List<Param>();

        Param speed = new Param();
        speed.name = "Speed";
        speed.callback = new UnityAction<string>(SetSpeed);
        speed.intialValue = leg.GetComponent<Leg>().flightSpeed.ToString();

        Param inboundAltitude = new Param();
        inboundAltitude.name = "Inbound Altitude";
        inboundAltitude.callback = new UnityAction<string>(SetInboundAltitude);
        inboundAltitude.intialValue = leg.GetComponent<Leg>().inboundAltitude.ToString();

        Param outboundAltitude = new Param();
        outboundAltitude.name = "Outbound Altitude";
        outboundAltitude.callback = new UnityAction<string>(SetOutboundAltitude);
        outboundAltitude.intialValue = leg.GetComponent<Leg>().outboundAltitude.ToString();


        paramaters.Add(speed);
        paramaters.Add(inboundAltitude); 
        paramaters.Add(outboundAltitude); 
        inspector.Edit(this.gameObject, leg.name, paramaters);  
    }

    private void OnMouseOver()
    {
        leg.GetComponent<Renderer>().material.color = Color.yellow;
    }

    private void OnMouseExit()
    {
        leg.GetComponent<Renderer>().material.color = Color.black;
    }
}
