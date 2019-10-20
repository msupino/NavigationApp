using System.Collections;
using System.Collections.Generic;
using UnityEngine;


// public class LegParameters
// {
//     public string name;
//     public System.Action<int> callback;
//     public LegParameters(string _name, System.Action<int> _callback)
//     {
//         name = _name;
//         callback = _callback;
//     }

// }

// public struct LegParameters
// {
//     public string name;
//     public System.Action<string> callback;
// }

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
        leg.GetComponent<Leg>().flightSpeed = (double)System.Convert.ToInt32(speed);
        Debug.Log("Changed speed to - " + speed);
    }
    
    public void SetAltitude(string altitude)
    {
        Debug.Log("Changed speed to - " + altitude);
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
        speed.callback = new System.Action<string>(SetSpeed);

        Param altitude = new Param();
        altitude.name = "altitude";
        altitude.callback = new System.Action<string>(SetAltitude);

        paramaters.Add(speed);
        paramaters.Add(altitude);  
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
