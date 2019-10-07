using System.Collections;
using System.Collections.Generic;
using UnityEngine;
using UnityEngine.Events;

namespace Tools
{

    public enum Tooltype
    {
        None,
        Draw,
        Erase
    }

    public class Toolbar
    {
        public Tooltype currentTool;
        public List<GameObject> buttons = new List<GameObject>();
        public UnityEvent eventDrawing = new UnityEvent();
        public UnityEvent eventStopDrawing = new UnityEvent();

        public Toolbar()
        {

        }

        public void StopAll()
        {

            foreach (GameObject btn in buttons)
            {
                btn.GetComponent<Tool>().Stop();     
            }
            currentTool = Tooltype.None;
        }

        public void SetTool(Tooltype t)
        {
            currentTool = t;
        }
    }

}