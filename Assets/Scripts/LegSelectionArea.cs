using System.Collections;
using System.Collections.Generic;
using UnityEngine;

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
        inspector.selected = this.gameObject;
        inspector.header.text = "Settings: " + leg.name;       
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
